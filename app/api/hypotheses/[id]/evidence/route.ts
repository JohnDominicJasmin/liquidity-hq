import { NextRequest, NextResponse } from 'next/server';
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
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ evidence: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ evidence: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const evidenceId = req.nextUrl.searchParams.get('evidenceId');
  if (!evidenceId) return NextResponse.json({ error: 'evidenceId required' }, { status: 400 });

  const { error } = await sb(token).from(T.hypothesis_evidence).delete().eq('id', evidenceId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
