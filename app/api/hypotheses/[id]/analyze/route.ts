import { NextRequest, NextResponse } from 'next/server';
import { xaiFetch } from '@/lib/xai';
import { recordAiCall } from '@/lib/aiCallLog';
import { T } from '@/lib/tables';
import { incrementToolUsage, rateLimitMessage, refundToolUsage, todayUtc, blockedResponse } from '@/lib/aiUsage';
import { requireProPlan, hasProFeatures } from '@/lib/entitlements';
import { apiError } from '@/lib/apiError';
import { TEXT_LIMITS, clip } from '@/lib/ownRowLimits';
import { getUserCompatForBilledCall } from '@/lib/authUser';
import { userClient } from '@/lib/supabase-user';
import { bearerToken } from '@/lib/bearerToken';

const GROK_KEY = process.env.GROK_API_KEY ?? '';

function sb(token: string) {
  return userClient(token);
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

/* HEADERS MAY ARRIVE WITH MARKDOWN (PM audit B10). "**VERDICT:**" did not start a line with a bare capital letter, so the section boundary was
   missed and one section ran into the next (a confidence value could carry the reasoning). Emphasis marks are stripped before reading, and a
   header may be preceded by punctuation or a list marker. */
function parseSection(raw: string, key: string): string {
  const text = raw.replace(/\*\*|__/g, '');
  const m = new RegExp(`^\\W*${key}:`, 'm').exec(text);
  if (!m) return '';
  const after = text.slice(m.index + m[0].length).trim();
  const nextHeader = after.search(/^\W*[A-Z_]{4,}:/m);
  return (nextHeader === -1 ? after : after.slice(0, nextHeader)).trim();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = bearerToken(req.headers) ?? '';
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: authData } = await getUserCompatForBilledCall(token);
  if (!authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only. /upgrade sells the one-shot AI tools as a Pro feature
  // (UPGRADE_PRO_FEATURE_TOOL_POOL); this route is one of them. Without this
  // check a free account could still spend real xAI budget here, which is
  // what the pricing page says it cannot. Trial users pass - hasProFeatures
  // covers isTrial.
  const plan = await requireProPlan(token, authData.user.id, 'AI hypothesis analysis is a Pro feature.');
  if (!plan.ok) return plan.response;

  if (!GROK_KEY) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });

  const { id } = await params;

  const [{ data: hyp }, { data: evs }] = await Promise.all([
    sb(token).from(T.hypotheses).select('*').eq('id', id).eq('user_id', authData.user.id).single(),
    sb(token).from(T.hypothesis_evidence).select('*').eq('hypothesis_id', id).eq('user_id', authData.user.id).order('created_at', { ascending: true }),
  ]);

  if (!hyp) return NextResponse.json({ error: 'Hypothesis not found' }, { status: 404 });

  /* RESERVE ONLY ONCE THE HYPOTHESIS EXISTS (U3): a bad or foreign id answered 404 after the charge. A reserved use is given back when nothing reached the user (a failed or unusable xAI answer, a thrown call, an empty answer), exactly as /api/grok does; nothing is given back once xAI answered 2xx (the tokens are billed). */
  const role = plan.tier;
  const reservedOn = todayUtc();
  const usageResult = await incrementToolUsage(authData.user.id, 'hypothesisAnalyze', role, reservedOn);
  if (usageResult.blocked) {
    return blockedResponse(usageResult.reason, rateLimitMessage(usageResult.reason, usageResult.limit, 'hypothesis analyses'));
  }

  const prompt = buildAnalysisPrompt(hyp as Hypothesis, (evs ?? []) as Evidence[]);

  let analysis = '';
  let billed = false;
  try {
    const r = await xaiFetch('https://api.x.ai/v1/chat/completions', {
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
      await refundToolUsage(authData.user.id, 'hypothesisAnalyze', reservedOn);
      const e = await r.json().catch(() => ({})) as { error?: string };
      return NextResponse.json({ error: e.error ?? 'AI error' }, { status: 502 });
    }
    const d = await r.json();
    billed = true;   // 2xx: the tokens are billed from here
    await recordAiCall({ userId: authData.user.id, callType: 'hypothesis_analyze', model: d.model ?? 'grok-4.3', usage: d.usage });
    analysis = d.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    if (!billed) await refundToolUsage(authData.user.id, 'hypothesisAnalyze', reservedOn);
    return apiError('hypotheses/[id]/analyze', e, 500, 'Request failed');
  }

  const verdict   = parseSection(analysis, 'VERDICT');
  const reasoning = parseSection(analysis, 'EVIDENCE_ASSESSMENT');
  const confidence = parseSection(analysis, 'CONFIDENCE');
  const keyInsight = parseSection(analysis, 'KEY_INSIGHT');
  const nextCheck = parseSection(analysis, 'NEXT_CHECK');

  /* THE FIRST WORD ONLY (PM audit B10). includes('CONFIRMED') accepted "UNCLEAR (CONFIRMED would need X)" as a confirmation. The verdict is the
     first word of the section, and anything else is UNCLEAR. */
  const verdictWord = /^\W*(DISCONFIRMED|CONFIRMED|UNCLEAR)\b/i.exec(verdict)?.[1]?.toUpperCase();
  const normalizedVerdict = verdictWord === 'CONFIRMED' ? 'CONFIRMED' : verdictWord === 'DISCONFIRMED' ? 'DISCONFIRMED' : 'UNCLEAR';

  /* THE USER'S OWN STATUS IS NOT OVERWRITTEN (PM audit B9). An UNCLEAR run wrote 'active' over a hypothesis the user had marked confirmed or
     expired by hand, and a conclusive run moved it without asking. The status only follows the analysis while the hypothesis is still 'active';
     in every other state the analysis is stored and the status is left as the user set it. */
  const currentStatus = (hyp as { status?: string }).status ?? 'active';
  const newStatus = currentStatus !== 'active'
    ? currentStatus
    : normalizedVerdict === 'CONFIRMED'
    ? 'confirmed'
    : normalizedVerdict === 'DISCONFIRMED'
    ? 'disconfirmed'
    : 'active';

  // #1632 H1: the database limits these columns (migration 20261021e); an over-long AI answer is cut, never refused (a refused update loses the analysis).
  await sb(token).from(T.hypotheses).update({
    grok_verdict: normalizedVerdict,
    grok_reasoning: clip(reasoning, TEXT_LIMITS.aiLong),
    grok_evidence_assessment: clip(analysis, TEXT_LIMITS.aiLong),
    grok_confidence: clip(confidence, TEXT_LIMITS.aiShort),
    grok_next_check: clip(nextCheck, TEXT_LIMITS.aiNextCheck),
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
