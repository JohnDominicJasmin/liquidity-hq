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

export async function GET(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb(token)
    .from(T.hypotheses)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hypotheses: data ?? [] });
}

export async function POST(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    title?: string;
    hypothesis?: string;
    acceptance_criteria?: string[];
    target_date?: string;
  };

  if (!body.title?.trim() || !body.hypothesis?.trim()) {
    return NextResponse.json({ error: 'title and hypothesis are required' }, { status: 400 });
  }

  const { data, error } = await sb(token)
    .from(T.hypotheses)
    .insert({
      user_id: userId,
      title: body.title.trim(),
      hypothesis: body.hypothesis.trim(),
      acceptance_criteria: body.acceptance_criteria?.filter(Boolean) ?? [],
      target_date: body.target_date ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hypothesis: data }, { status: 201 });
}
