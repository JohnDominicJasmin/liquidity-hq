import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

function auth(req: NextRequest) {
  return req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { data, error } = await sb(token)
    .from(T.hypothesis_evidence)
    .select('*')
    .eq('hypothesis_id', id)
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false });

  if (error) return apiError('hypotheses/[id]/evidence', error);
  return NextResponse.json({ evidence: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Verify the target hypothesis actually belongs to the caller before
  // attaching evidence to it. RLS on hypothesis_evidence only scopes by the
  // evidence row's OWN user_id (which is always the caller's own id here),
  // so without this check a caller could attach their own evidence to
  // someone else's hypothesis just by guessing/enumerating its id.
  const { data: hyp, error: hypErr } = await sb(token)
    .from(T.hypotheses)
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (hypErr) return NextResponse.json({ error: hypErr.message }, { status: 500 });
  if (!hyp) return NextResponse.json({ error: 'Hypothesis not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    type?: string;
    content?: string;
    source?: string;
  };

  if (!body.content?.trim() || !body.type) {
    return NextResponse.json({ error: 'type and content are required' }, { status: 400 });
  }
  if (!['supporting','against','neutral'].includes(body.type)) {
    return NextResponse.json({ error: 'type must be supporting, against, or neutral' }, { status: 400 });
  }

  const { data, error } = await sb(token)
    .from(T.hypothesis_evidence)
    .insert({
      hypothesis_id: id,
      user_id: userId,
      type: body.type,
      content: body.content.trim(),
      source: body.source?.trim() || null,
    })
    .select()
    .single();

  if (error) return apiError('hypotheses/[id]/evidence', error);
  return NextResponse.json({ evidence: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const evidenceId = req.nextUrl.searchParams.get('evidenceId');
  if (!evidenceId) return NextResponse.json({ error: 'evidenceId required' }, { status: 400 });

  /* Same fix as the parent route's DELETE, found by the same sweep. .eq('user_id')
     is the ownership filter, so deleting somebody else's evidence row matches
     zero rows - and PostgREST calls that success. Not reported by QA; found by
     grepping every .delete() in app/api after they caught the hypotheses one. */
  const { data, error } = await sb(token)
    .from(T.hypothesis_evidence)
    .delete()
    .eq('id', evidenceId)
    .eq('user_id', authData.user.id)
    .select('id');
  if (error) return apiError('hypotheses/[id]/evidence', error);
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
