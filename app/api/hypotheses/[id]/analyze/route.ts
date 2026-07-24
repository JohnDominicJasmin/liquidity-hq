import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { incrementToolUsage } from '@/lib/aiUsage';
import { getUserRole } from '@/lib/entitlements';
import { AI_LIMITS } from '@/lib/limits';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

interface Hypothesis {
  id: string;
  title: string;
  hypothesis: string;
  acceptance_criteria: string[];
  target_date?: string | null;
}

interface Evidence {
  type: 'supporting' | 'against' | 'neutral';
  content: string;
  source?: string | null;
  created_at: string;
}

function buildAnalysisPrompt(h: Hypothesis, evidence: Evidence[]): string {
  const criteriaList = (h.acceptance_criteria ?? []).length > 0
    ? h.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
    : '  (No specific criteria defined - use your judgment based on the hypothesis)';

  const evidenceList = evidence.length > 0
    ? evidence.map(e => {
        const tag = e.type === 'supporting' ? '[FOR]' : e.type === 'against' ? '[AGAINST]' : '[NEUTRAL]';
        const date = new Date(e.created_at).toISOString().slice(0, 10);
        return `  ${tag} ${date} - ${e.content}${e.source ? ` (Source: ${e.source})` : ''}`;
      }).join('\n')
    : '  (No evidence logged yet)';

  const today = new Date().toISOString().slice(0, 10);
  const targetNote = h.target_date ? `\nTarget date: ${h.target_date}` : '';

  return [
    `You are a research analyst evaluating a crypto trader's structured hypothesis. Today is ${today}.${targetNote}`,
    '',
    '=== HYPOTHESIS ===',
    `Title: ${h.title}`,
    `Thesis: ${h.hypothesis}`,
    '',
    '=== ACCEPTANCE CRITERIA (confirmed when ALL are met) ===',
    criteriaList,
    '',
    `=== EVIDENCE LOG (${evidence.length} entries, newest last) ===`,
    evidenceList,
    '',
    '=== YOUR TASK ===',
    '',
    'Evaluate each acceptance criterion against the evidence. Then output EXACTLY these headers:',
    '',
    'EVIDENCE_ASSESSMENT:',
    '[For each criterion: "1. MET / NOT MET / UNCLEAR - one sentence." If no criteria, assess the thesis directly.]',
    '',
    'VERDICT:',
    '[Exactly one of: CONFIRMED | DISCONFIRMED | UNCLEAR]',
    '[CONFIRMED = evidence strongly satisfies acceptance criteria]',
    '[DISCONFIRMED = evidence clearly contradicts the thesis]',
    '[UNCLEAR = insufficient evidence or mixed signals]',
    '',
    'CONFIDENCE:',
    '[e.g. "3/5 criteria met" or "Strong - all evidence aligns" or "Weak - only 1 piece of supporting evidence"]',
    '',
    'KEY_INSIGHT:',
    '[The single most important thing the evidence tells you in one sentence]',
    '',
    'NEXT_CHECK:',
    '[One specific, actionable thing to look for or measure next to resolve remaining uncertainty]',
  ].join('\n');
}

function parseSection(text: string, key: string): string {
  const start = text.indexOf(`${key}:`);
  if (start === -1) return '';
  const after = text.slice(start + key.length + 1).trim();
  const nextHeader = after.search(/^[A-Z_]+:/m);
  return (nextHeader === -1 ? after : after.slice(0, nextHeader)).trim();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await sb(token).auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const role = await getUserRole(token, authData.user.id);
  const limit = AI_LIMITS[role].hypothesisAnalyze;
  const newCount = await incrementToolUsage(token, authData.user.id, 'hypothesisAnalyze', limit);
  if (newCount === null) {
    return NextResponse.json(
      { error: `Daily limit of ${limit} hypothesis analyses reached.`, code: 'RATE_LIMIT' },
      { status: 429 },
    );
  }

  const { id } = await params;

  const [{ data: hyp }, { data: evs }] = await Promise.all([
    sb(token).from(T.hypotheses).select('*').eq('id', id).eq('user_id', authData.user.id).single(),
    sb(token).from(T.hypothesis_evidence).select('*').eq('hypothesis_id', id).eq('user_id', authData.user.id).order('created_at', { ascending: true }),
  ]);

  if (!hyp) return NextResponse.json({ error: 'Hypothesis not found' }, { status: 404 });

  const prompt = buildAnalysisPrompt(hyp as Hypothesis, (evs ?? []) as Evidence[]);

  let analysis = '';
  try {
    const r = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY}` },
      body: JSON.stringify({
        model: 'grok-4.3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({})) as { error?: string };
      return NextResponse.json({ error: e.error ?? 'Grok error' }, { status: 502 });
    }
    const d = await r.json();
    analysis = d.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed' }, { status: 500 });
  }

  const verdict   = parseSection(analysis, 'VERDICT');
  const reasoning = parseSection(analysis, 'EVIDENCE_ASSESSMENT');
  const confidence = parseSection(analysis, 'CONFIDENCE');
  const keyInsight = parseSection(analysis, 'KEY_INSIGHT');
  const nextCheck = parseSection(analysis, 'NEXT_CHECK');

  const normalizedVerdict = verdict.includes('CONFIRMED') && !verdict.includes('DIS')
    ? 'CONFIRMED'
    : verdict.includes('DISCONFIRMED')
    ? 'DISCONFIRMED'
    : 'UNCLEAR';

  // Auto-update status if conclusive
  const newStatus = normalizedVerdict === 'CONFIRMED'
    ? 'confirmed'
    : normalizedVerdict === 'DISCONFIRMED'
    ? 'disconfirmed'
    : 'active';

  await sb(token).from(T.hypotheses).update({
    grok_verdict: normalizedVerdict,
    grok_reasoning: reasoning,
    grok_evidence_assessment: analysis,
    grok_confidence: confidence,
    grok_next_check: nextCheck,
    grok_last_run: new Date().toISOString(),
    status: newStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('user_id', authData.user.id);

  return NextResponse.json({
    verdict: normalizedVerdict,
    evidence_assessment: reasoning,
    confidence,
    key_insight: keyInsight,
    next_check: nextCheck,
    full_analysis: analysis,
    status: newStatus,
  });
}
