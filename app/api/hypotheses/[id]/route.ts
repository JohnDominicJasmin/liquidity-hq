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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const allowed = ['title','hypothesis','acceptance_criteria','status','target_date'];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (k in body) update[k] = body[k];
  }

  /* maybeSingle, not single. The .eq('user_id') above is the ownership filter,
     so an update aimed at somebody else's row - or at an id that does not exist
     - legitimately matches ZERO rows. single() treats that as the error
     PGRST116 and apiError turned it into a 500, so every authorization denial
     on this route looked identical to a genuine server fault. Found by QA's
     BOLA suite: a PATCH against a UUID that exists nowhere returned 500 too,
     which is what isolated it from anything to do with entitlements.
     The data was never at risk - it failed closed - but you cannot alert on
     500s when refusals are also 500s. */
  const { data, error } = await sb(token)
    .from(T.hypotheses)
    .update(update)
    .eq('id', id)
    .eq('user_id', authData.user.id)
    .select()
    .maybeSingle();

  if (error) return apiError('hypotheses/[id]', error);
  /* 404, not 403. 403 would confirm the row exists and belongs to someone else,
     which hands an attacker a working existence oracle for enumerating ids.
     404 is the same answer for "no such row" and "not yours", so it leaks
     nothing while still being an honest, alertable status code. */
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ hypothesis: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { error } = await sb(token)
    .from(T.hypotheses)
    .delete()
    .eq('id', id)
    .eq('user_id', authData.user.id);
  if (error) return apiError('hypotheses/[id]', error);
  return NextResponse.json({ ok: true });
}
