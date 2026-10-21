import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { T } from '@/lib/tables';
import { TEXT_LIMITS, limitRefusal } from '@/lib/ownRowLimits';
import { getUserCompat } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';

function sb(token: string) {
  return userClient(token);
}

function auth(req: NextRequest) {
  return req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
}

export async function GET(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await getUserCompat(token);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb(token)
    .from(T.hypotheses)
    .select('*')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false });

  if (error) return apiError('hypotheses', error);
  return NextResponse.json({ hypotheses: data ?? [] });
}

export async function POST(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await getUserCompat(token);
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
  // #1632 H1: the limits the database enforces (migration 20261021e), said first.
  const criteria = Array.isArray(body.acceptance_criteria) ? body.acceptance_criteria.filter((c): c is string => typeof c === 'string' && c.length > 0) : [];
  if (body.title.length > TEXT_LIMITS.hypothesisTitle || body.hypothesis.length > TEXT_LIMITS.hypothesis
      || criteria.length > TEXT_LIMITS.criteriaCount || criteria.some(c => c.length > TEXT_LIMITS.criterion)) {
    return NextResponse.json({ error: 'TOO_LONG', message: `Title up to ${TEXT_LIMITS.hypothesisTitle} characters, hypothesis up to ${TEXT_LIMITS.hypothesis}, and up to ${TEXT_LIMITS.criteriaCount} criteria of ${TEXT_LIMITS.criterion} each.` }, { status: 400 });
  }

  const { data, error } = await sb(token)
    .from(T.hypotheses)
    .insert({
      user_id: userId,
      title: body.title.trim(),
      hypothesis: body.hypothesis.trim(),
      acceptance_criteria: criteria,
      target_date: body.target_date ?? null,
    })
    .select()
    .single();

  if (error) {
    const refusal = limitRefusal(error);
    if (refusal) return NextResponse.json({ error: refusal.error, message: refusal.message }, { status: refusal.status });
    return apiError('hypotheses', error);
  }
  return NextResponse.json({ hypothesis: data }, { status: 201 });
}
