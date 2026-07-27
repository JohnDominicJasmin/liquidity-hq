'use client';
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { COINS, CoinId } from '@/lib/marketStore';
import { getLocalNow, getSessionName } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import AuthGate from './AuthGate';
import { useAuth } from './AuthProvider';
import Tip from './Tip';
import { Warn } from './icons';
import { track } from '@/lib/analytics';
import { withAlpha } from '@/lib/color';
import { T } from '@/lib/tables';
import { coinBadgeColor } from '@/lib/coinBadge';
import LoadingState from '@/components/LoadingState';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

type Direction = 'LONG' | 'SHORT';
type TradeResult = 'OPEN' | 'WIN' | 'LOSS' | 'BE';
type SetupType = 'Squeeze' | 'Breakout' | 'Reversal' | 'Range' | 'News' | 'Other';

/* ── Rule Engine types ── */
type RuleField    = 'coin' | 'direction' | 'setup_type' | 'leverage' | 'session';
type RuleOperator = 'is' | 'is_not' | 'lte' | 'gte';

interface TradingRule {
  id:       string;
  name:     string;
  field:    RuleField;
  operator: RuleOperator;
  value:    string;   // comma-separated for multi-value (coin, session)
  enabled:  boolean;
}

const RULE_FIELD_LABEL_KEYS: Record<RuleField, LabelKey> = {
  coin:       'TRADE_JOURNAL_RULES_FIELD_COIN',
  direction:  'TRADE_JOURNAL_RULES_FIELD_DIRECTION',
  setup_type: 'TRADE_JOURNAL_RULES_FIELD_SETUP',
  leverage:   'TRADE_JOURNAL_RULES_FIELD_LEVERAGE',
  session:    'TRADE_JOURNAL_RULES_FIELD_SESSION',
};

const RULE_OP_LABEL_KEYS: Record<RuleOperator, LabelKey> = {
  is:     'TRADE_JOURNAL_RULES_OP_IS',
  is_not: 'TRADE_JOURNAL_RULES_OP_IS_NOT',
  lte:    'TRADE_JOURNAL_RULES_OP_LTE',
  gte:    'TRADE_JOURNAL_RULES_OP_GTE',
};

const SESSIONS = ['New York', 'London', 'Asia', 'Pre-Market', 'Weekend'];

/* Check a single rule against live form fields. Returns true = VIOLATION */
function ruleViolated(rule: TradingRule, fields: {
  coin: string; direction: string; setup_type: string; leverage: number; session: string;
}): boolean {
  if (!rule.enabled) return false;
  const raw = fields[rule.field];
  const vals = rule.value.split(',').map(v => v.trim().toLowerCase());
  const cmp  = String(raw).toLowerCase();
  switch (rule.operator) {
    case 'is':     return !vals.includes(cmp);
    case 'is_not': return vals.includes(cmp);
    case 'lte':    return Number(raw) > Number(rule.value);
    case 'gte':    return Number(raw) < Number(rule.value);
  }
}

/* Human-readable rule summary */
function ruleLabel(r: TradingRule, t: (key: LabelKey, vars?: Record<string, string | number>) => string): string {
  const field = t(RULE_FIELD_LABEL_KEYS[r.field]);
  const op    = t(RULE_OP_LABEL_KEYS[r.operator]);
  const val   = (r.operator === 'lte' || r.operator === 'gte')
    ? (r.field === 'leverage' ? r.value + 'x' : r.value)
    : r.value.split(',').map(v => v.trim()).join(', ');
  return `${field} ${op} ${val}`;
}

/* Quick-add presets. `name` stays the stable, untranslated id used for the
   exists-check and persisted rule storage; `labelKey` is the translated
   display text shown on the button. */
const RULE_PRESETS: (Omit<TradingRule, 'id'> & { labelKey: LabelKey })[] = [
  { name: 'Only long BTC/ETH',      field: 'coin',       operator: 'is',     value: 'btc,eth',      enabled: true, labelKey: 'TRADE_JOURNAL_RULES_PRESET_LONG_BTC_ETH' },
  { name: 'Max 20x leverage',       field: 'leverage',   operator: 'lte',    value: '20',           enabled: true, labelKey: 'TRADE_JOURNAL_RULES_PRESET_MAX_20X_LEVERAGE' },
  { name: 'Only LONG trades',       field: 'direction',  operator: 'is',     value: 'LONG',         enabled: true, labelKey: 'TRADE_JOURNAL_RULES_PRESET_ONLY_LONG' },
  { name: 'Squeeze setups only',    field: 'setup_type', operator: 'is',     value: 'Squeeze',      enabled: true, labelKey: 'TRADE_JOURNAL_RULES_PRESET_SQUEEZE_ONLY' },
  { name: 'NY or London only',      field: 'session',    operator: 'is',     value: 'New York,London', enabled: true, labelKey: 'TRADE_JOURNAL_RULES_PRESET_NY_LONDON' },
  { name: 'No Other setup',         field: 'setup_type', operator: 'is_not', value: 'Other',        enabled: true, labelKey: 'TRADE_JOURNAL_RULES_PRESET_NO_OTHER_SETUP' },
];

interface Trade {
  id?: string;
  created_at?: string;
  coin: string;
  direction: Direction;
  setup_type: string;
  entry_price: number;
  exit_price?: number | null;
  stop_loss: number;
  take_profit?: number | null;
  position_size_usd?: number | null;
  risk_usd?: number | null;
  leverage?: number | null;
  result: TradeResult;
  pnl_usd?: number | null;
  pnl_r?: number | null;
  notes?: string;
  session?: string;
}

const SETUPS: SetupType[] = ['Squeeze', 'Breakout', 'Reversal', 'Range', 'News', 'Other'];

function fmtUSD(v: number | null | undefined, showSign = true) {
  if (v == null) return '-';
  const sign = showSign && v >= 0 ? '+' : '';
  return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* R-multiple from price levels alone - independent of position_size_usd /
   risk_usd, which cancel out in the true ratio: (exit-entry)*dir / |entry-stop|.
   Falls back to this whenever a trade's stored pnl_r is null (legacy rows
   closed before risk_usd was reliably captured - see QA-1), so a real
   winning/losing trade never silently drops out of the R stats. */
function tradeR(tr: Trade): number | null {
  if (tr.pnl_r != null) return tr.pnl_r;
  if (tr.exit_price == null) return null;
  const stopDist = Math.abs(tr.entry_price - tr.stop_loss);
  if (stopDist <= 0) return null;
  const dir = tr.direction === 'LONG' ? 1 : -1;
  return ((tr.exit_price - tr.entry_price) * dir) / stopDist;
}

function fmtDate(s: string) {
  const d = new Date(s);
  // undefined locale = follow the viewer's own formatting conventions. The
  // instant was always right here (no timeZone override), but 'en-PH' forced
  // Philippine date/time formatting on every user.
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/* ── Shadow Account result renderer ── */
const SHADOW_SECTIONS: { key: string; labelKey: LabelKey; color?: string }[] = [
  { key: 'IMPLICIT_RULES',       labelKey: 'TRADE_JOURNAL_SHADOW_SECTION_IMPLICIT_RULES' },
  { key: 'BEHAVIORAL_PATTERNS',  labelKey: 'TRADE_JOURNAL_SHADOW_SECTION_BEHAVIORAL_PATTERNS' },
  { key: 'SHADOW_STRATEGY',      labelKey: 'TRADE_JOURNAL_SHADOW_SECTION_STRATEGY', color: 'var(--accent)' },
  { key: 'RULE_VIOLATIONS',      labelKey: 'TRADE_JOURNAL_SHADOW_SECTION_VIOLATIONS', color: 'var(--red)' },
  { key: 'RECOMMENDATIONS',      labelKey: 'TRADE_JOURNAL_SHADOW_SECTION_RECOMMENDATIONS', color: 'var(--green)' },
  { key: 'KEY_INSIGHT',          labelKey: 'TRADE_JOURNAL_SHADOW_SECTION_KEY_INSIGHT', color: 'var(--amber)' },
];

function parseShadowSection(text: string, key: string): string {
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + SHADOW_SECTIONS.map(s => s.key).join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

function ShadowAccountResult({ text }: { text: string }) {
  const { t } = useLabels();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {SHADOW_SECTIONS.map(({ key, labelKey, color }) => {
        const content = parseShadowSection(text, key);
        if (!content) return null;
        return (
          <div key={key} style={{
            background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
            borderRadius: 'var(--radius-card)', padding: '12px 14px',
          }}>
            <div style={{
              fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: color ?? 'var(--txt3)', marginBottom: 8,
            }}>
              {t(labelKey)}
            </div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {content}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Behavioral Bias ── */
const BIAS_SECTIONS: { key: string; labelKey: LabelKey; color?: string }[] = [
  { key: 'DISPOSITION_EFFECT', labelKey: 'TRADE_JOURNAL_BIAS_SECTION_DISPOSITION_EFFECT', color: 'var(--red)' },
  { key: 'OVERTRADING',        labelKey: 'TRADE_JOURNAL_BIAS_SECTION_OVERTRADING',         color: 'var(--orange)' },
  { key: 'MOMENTUM_CHASING',   labelKey: 'TRADE_JOURNAL_BIAS_SECTION_MOMENTUM_CHASING',    color: 'var(--amber)' },
  { key: 'ANCHORING_BIAS',     labelKey: 'TRADE_JOURNAL_BIAS_SECTION_ANCHORING',           color: 'var(--accent-2)' },
  { key: 'PNL_IMPACT',         labelKey: 'TRADE_JOURNAL_BIAS_SECTION_PNL_IMPACT',          color: 'var(--accent)' },
  { key: 'PRIORITY_FIX',       labelKey: 'TRADE_JOURNAL_BIAS_SECTION_PRIORITY_FIX',        color: 'var(--green)' },
];

function parseBiasSection(text: string, key: string): string {
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + BIAS_SECTIONS.map(s => s.key).join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

function BiasResult({ text }: { text: string }) {
  const { t } = useLabels();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {BIAS_SECTIONS.map(({ key, labelKey, color }) => {
        const content = parseBiasSection(text, key);
        if (!content) return null;
        return (
          <div key={key} style={{ background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 'var(--radius-card)', padding: '12px 14px' }}>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: color ?? 'var(--txt3)', marginBottom: 8 }}>
              {t(labelKey)}
            </div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {content}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Thesis Tracker ── */
interface TradeThesis {
  id:            string;
  symbol:        string;
  direction:     'LONG' | 'SHORT';
  entryDate:     string;
  thesisText:    string;
  assumptions:   string[];
  lastScore?:    number;
  lastScoreDate?: string;
  lastFeedback?:  string;
  createdAt:     string;
}

const THESIS_KEY = 'lhq_theses';

const THESIS_CHECK_SECTIONS: { key: string; labelKey: LabelKey; color?: string }[] = [
  { key: 'ASSUMPTION_CHECK', labelKey: 'TRADE_JOURNAL_THESIS_SECTION_ASSUMPTION_CHECK' },
  { key: 'THESIS_HEALTH',    labelKey: 'TRADE_JOURNAL_THESIS_SECTION_HEALTH_SCORE', color: 'var(--accent)' },
  { key: 'KEY_RISK',         labelKey: 'TRADE_JOURNAL_THESIS_SECTION_KEY_RISK',      color: 'var(--red)' },
  { key: 'RECOMMENDATION',   labelKey: 'TRADE_JOURNAL_THESIS_SECTION_RECOMMENDATION', color: 'var(--green)' },
];

function parseThesisSection(text: string, key: string): string {
  const regex = new RegExp(key + ':\\s*([\\s\\S]*?)(?=' + THESIS_CHECK_SECTIONS.map(s => s.key).join(':|') + ':|$)');
  return (text.match(regex)?.[1] ?? '').trim();
}

function extractScore(feedback: string): number | undefined {
  const m = feedback.match(/Score:\s*(\d+)\s*\/\s*10/i);
  return m ? parseInt(m[1]) : undefined;
}

function loadTheses(): TradeThesis[] {
  try { return JSON.parse(localStorage.getItem(THESIS_KEY) ?? '[]') as TradeThesis[]; }
  catch { return []; }
}

function saveTheses(ts: TradeThesis[]) {
  try { localStorage.setItem(THESIS_KEY, JSON.stringify(ts)); } catch { /* ignore */ }
}

/* ── inner component (needs useSearchParams) ── */
function Inner() {
  const sp     = useSearchParams();
  const router = useRouter();
  const { t }  = useLabels();
  const { user } = useAuth();

  const [tab,       setTab]       = useState<'log' | 'history' | 'stats' | 'rules' | 'shadow' | 'bias' | 'thesis'>('log');
  const [trades,    setTrades]    = useState<Trade[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitInput, setExitInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ result: TradeResult; exit_price: string; pnl_usd: string; notes: string }>(
    { result: 'OPEN', exit_price: '', pnl_usd: '', notes: '' }
  );
  const [noDb,      setNoDb]      = useState(false);
  const [historyPage, setHistoryPage] = useState(0);

  /* Behavioral Bias state */
  const [biasLoading,  setBiasLoading]  = useState(false);
  const [biasAnalysis, setBiasAnalysis] = useState<string | null>(null);
  const [biasError,    setBiasError]    = useState<string | null>(null);

  /* Thesis Tracker state */
  const [theses,           setTheses]           = useState<TradeThesis[]>(() => loadTheses());
  const [showThesisForm,   setShowThesisForm]   = useState(false);
  const [checkingThesisId, setCheckingThesisId] = useState<string | null>(null);
  const [thesisFormSymbol,     setThesisFormSymbol]     = useState('');
  const [thesisFormDirection,  setThesisFormDirection]  = useState<'LONG' | 'SHORT'>('LONG');
  const [thesisFormDate,       setThesisFormDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [thesisFormText,       setThesisFormText]       = useState('');
  const [thesisFormAssumptions, setThesisFormAssumptions] = useState(['', '', '']);

  /* Shadow Account state */
  const [shadowLoading,  setShadowLoading]  = useState(false);
  const [shadowAnalysis, setShadowAnalysis] = useState<string | null>(null);
  const [shadowError,    setShadowError]    = useState<string | null>(null);

  /* Rule Engine state */
  const [rules,        setRules]        = useState<TradingRule[]>([]);
  const [ruleField,    setRuleField]    = useState<RuleField>('coin');
  const [ruleOp,       setRuleOp]       = useState<RuleOperator>('is');
  const [ruleValue,    setRuleValue]    = useState('');
  const [ruleName,     setRuleName]     = useState('');
  const [showRuleForm, setShowRuleForm] = useState(false);

  /* Form state - pre-fill from URL params (from Position Sizer) */
  const [coin,      setCoin]      = useState<CoinId>((sp.get('coin') as CoinId) || 'btc');
  const [direction, setDirection] = useState<Direction>((sp.get('dir') as Direction) || 'LONG');
  const [setup,     setSetup]     = useState<SetupType>('Squeeze');
  const [entry,     setEntry]     = useState(sp.get('entry') || '');
  const [stopLoss,  setStopLoss]  = useState(sp.get('stop') || '');
  const [tpPrice,   setTpPrice]   = useState(sp.get('tp') || '');
  const [posUSD,    setPosUSD]    = useState('');
  const [leverage,  setLeverage]  = useState(8);
  const [notes,     setNotes]     = useState('');

  /* Auto risk_usd if coming from Position Sizer */
  const autoRiskUSD = useMemo(() => {
    const acc  = sp.get('acc');
    const risk = sp.get('risk');
    return acc && risk ? parseFloat(acc) * (parseFloat(risk) / 100) : null;
  }, [sp]);

  /* True $ at risk for THIS trade - derived from entry/stop/position size
     whenever all three are known, so it's correct regardless of how the
     trade was logged. Falls back to the sizer's account×risk% only when no
     position size is set. Without this, any trade logged without a URL
     acc+risk pair (e.g. direct entry, or the sizer used without an account
     size filled in) saved risk_usd=null - pnl_r then never computes on
     close, silently dropping the trade out of every R-multiple stat. */
  const riskFromLevels = useMemo(() => {
    const e = parseFloat(entry), s = parseFloat(stopLoss), p = parseFloat(posUSD);
    if (!e || !s || !p || e === s) return null;
    return (p / e) * Math.abs(e - s);
  }, [entry, stopLoss, posUSD]);
  const riskUsd = riskFromLevels ?? autoRiskUSD;

  /* Load trades */
  const loadTrades = async () => {
    const db = getSupabase();
    if (!db) { setNoDb(true); return; }
    setLoading(true);
    const { data, error } = await db
      .from(T.trades)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (!error && data) setTrades(data as Trade[]);
    setLoading(false);
  };

  useEffect(() => { loadTrades(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Load / save rules from localStorage */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lhq_trading_rules');
      if (saved) setRules(JSON.parse(saved) as TradingRule[]);
    } catch { /* ignore */ }
  }, []);

  const persistRules = (next: TradingRule[]) => {
    setRules(next);
    try { localStorage.setItem('lhq_trading_rules', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const addRule = (partial: Omit<TradingRule, 'id'>) => {
    persistRules([...rules, { ...partial, id: Date.now().toString() }]);
  };

  const deleteRule = (id: string) => persistRules(rules.filter(r => r.id !== id));

  const toggleRule = (id: string) =>
    persistRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));

  const addPreset = (preset: Omit<TradingRule, 'id'>) => {
    if (rules.some(r => r.name === preset.name)) return;
    addRule(preset);
  };

  /* Live violations for the current form state */
  const pht     = typeof window !== 'undefined' ? getLocalNow() : new Date();
  const session = getSessionName(pht) ?? '';

  const activeViolations = useMemo(() => {
    const liveFields = { coin, direction, setup_type: setup, leverage, session };
    return rules.filter(r => r.enabled && ruleViolated(r, liveFields));
  }, [rules, coin, direction, setup, leverage, session]);

  /* QA-2: flag price levels that are nonsensical for the chosen direction -
     e.g. a take-profit below entry on a LONG. Advisory only (same pattern as
     rule violations above), not a hard block, since the user may be logging
     a trade after the fact with approximate levels. */
  const levelWarnings = useMemo(() => {
    const warnings: string[] = [];
    const e = parseFloat(entry), s = parseFloat(stopLoss), tp = parseFloat(tpPrice);
    const long = direction === 'LONG';
    if (e && s) {
      if (long && s >= e)  warnings.push(t('TRADE_JOURNAL_WARN_STOP_ABOVE_ENTRY_LONG', { stop: s, entry: e }));
      if (!long && s <= e) warnings.push(t('TRADE_JOURNAL_WARN_STOP_BELOW_ENTRY_SHORT', { stop: s, entry: e }));
    }
    if (e && tpPrice && tp) {
      if (long && tp <= e)  warnings.push(t('TRADE_JOURNAL_WARN_TP_BELOW_ENTRY_LONG', { tp, entry: e }));
      if (!long && tp >= e) warnings.push(t('TRADE_JOURNAL_WARN_TP_ABOVE_ENTRY_SHORT', { tp, entry: e }));
    }
    return warnings;
  }, [entry, stopLoss, tpPrice, direction, t]);

  /* Which closed trades violate at least one active rule */
  const violatingTradeIds = useMemo(() => {
    const active = rules.filter(r => r.enabled);
    if (!active.length) return new Set<string>();
    return new Set(
      trades
        .filter(tr => tr.result !== 'OPEN' && tr.id && active.some(r =>
          ruleViolated(r, {
            coin:       tr.coin,
            direction:  tr.direction,
            setup_type: tr.setup_type,
            leverage:   tr.leverage ?? 1,
            session:    tr.session ?? '',
          })
        ))
        .map(tr => tr.id!)
    );
  }, [rules, trades]);

  /* Compliance score over closed trades */
  const complianceScore = useMemo(() => {
    const closed = trades.filter(tr => tr.result !== 'OPEN');
    if (!closed.length || !rules.some(r => r.enabled)) return null;
    const clean = closed.filter(tr => !violatingTradeIds.has(tr.id!));
    return { pct: Math.round((clean.length / closed.length) * 100), clean: clean.length, total: closed.length };
  }, [trades, violatingTradeIds, rules]);

  const runShadowAccount = async () => {
    const db = getSupabase();
    if (!db) return;
    setShadowLoading(true);
    setShadowError(null);
    setShadowAnalysis(null);
    try {
      const token = (await db.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/shadow-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json() as { analysis?: string; error?: string; count?: number };
      if (!res.ok) {
        if (json.error === 'NEED_MORE_TRADES') {
          setShadowError(t('TRADE_JOURNAL_SHADOW_NEED_MORE_TRADES', { count: json.count ?? 0 }));
        } else {
          setShadowError(json.error ?? t('TRADE_JOURNAL_ANALYSIS_FAILED'));
        }
      } else {
        setShadowAnalysis(json.analysis ?? null);
      }
    } catch {
      setShadowError(t('TRADE_JOURNAL_NETWORK_ERROR'));
    } finally {
      setShadowLoading(false);
    }
  };

  /* Behavioral Bias runner */
  const runBiasAnalysis = async () => {
    const db = getSupabase();
    if (!db) return;
    setBiasLoading(true);
    setBiasError(null);
    setBiasAnalysis(null);
    try {
      const token = (await db.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/behavioral-bias', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json() as { analysis?: string; error?: string; count?: number };
      if (!res.ok) {
        if (json.error === 'NEED_MORE_TRADES') {
          setBiasError(t('TRADE_JOURNAL_BIAS_NEED_MORE_TRADES', { count: json.count ?? 0 }));
        } else {
          setBiasError(json.error ?? t('TRADE_JOURNAL_ANALYSIS_FAILED'));
        }
      } else {
        setBiasAnalysis(json.analysis ?? null);
      }
    } catch {
      setBiasError(t('TRADE_JOURNAL_NETWORK_ERROR'));
    } finally {
      setBiasLoading(false);
    }
  };

  /* Thesis helpers */
  const addThesis = () => {
    if (!thesisFormSymbol.trim() || !thesisFormText.trim()) return;
    const validAssumptions = thesisFormAssumptions.filter(a => a.trim());
    if (validAssumptions.length < 1) return;
    const thesis: TradeThesis = {
      id:          crypto.randomUUID(),
      symbol:      thesisFormSymbol.toUpperCase().trim(),
      direction:   thesisFormDirection,
      entryDate:   thesisFormDate,
      thesisText:  thesisFormText.trim(),
      assumptions: validAssumptions,
      createdAt:   new Date().toISOString(),
    };
    const updated = [thesis, ...theses];
    setTheses(updated);
    saveTheses(updated);
    setShowThesisForm(false);
    setThesisFormSymbol('');
    setThesisFormText('');
    setThesisFormAssumptions(['', '', '']);
    setThesisFormDate(new Date().toISOString().slice(0, 10));
  };

  const deleteThesis = (id: string) => {
    const updated = theses.filter(th => th.id !== id);
    setTheses(updated);
    saveTheses(updated);
  };

  const checkThesisHealth = async (thesis: TradeThesis) => {
    const db = getSupabase();
    if (!db) return;
    setCheckingThesisId(thesis.id);
    try {
      const token = (await db.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/thesis-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          symbol:      thesis.symbol,
          direction:   thesis.direction,
          entryDate:   thesis.entryDate,
          thesisText:  thesis.thesisText,
          assumptions: thesis.assumptions,
        }),
      });
      const json = await res.json() as { analysis?: string; error?: string };
      if (!res.ok) return;
      const feedback = json.analysis ?? '';
      const score    = extractScore(feedback);
      const updated  = theses.map(th => th.id === thesis.id
        ? { ...th, lastFeedback: feedback, lastScore: score, lastScoreDate: new Date().toISOString().slice(0, 10) }
        : th,
      );
      setTheses(updated);
      saveTheses(updated);
    } finally {
      setCheckingThesisId(null);
    }
  };

  /* Go to log tab if pre-filled from calc */
  useEffect(() => { if (sp.get('entry')) setTab('log'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Save new trade */
  const saveTrade = async () => {
    const db = getSupabase();
    if (!db || !user) return;
    const entryNum = parseFloat(entry);
    const stopNum  = parseFloat(stopLoss);
    if (!entryNum || !stopNum) return;

    const pht     = getLocalNow();
    const session = getSessionName(pht);

    setSaving(true);
    const payload = {
      user_id: user.id,
      coin, direction, setup_type: setup,
      entry_price: entryNum, stop_loss: stopNum,
      exit_price:       null,
      take_profit:      tpPrice ? parseFloat(tpPrice) : null,
      position_size_usd: posUSD ? parseFloat(posUSD) : null,
      risk_usd:         riskUsd,
      leverage,
      result:           'OPEN',
      pnl_usd:          null,
      pnl_r:            null,
      notes, session,
    };

    let { error } = await db.from(T.trades).insert(payload);

    // Graceful fallback: if leverage column doesn't exist yet, retry without it
    if (error && error.message?.includes('leverage')) {
      const { leverage: _lev, ...payloadNoLev } = payload;
      const res2 = await db.from(T.trades).insert(payloadNoLev);
      error = res2.error;
    }

    if (!error) {
      track.journalSaved('OPEN');
      await loadTrades();
      setEntry(''); setStopLoss(''); setTpPrice(''); setPosUSD(''); setLeverage(8); setNotes('');
      setTab('history');
      router.replace('/journal');
    }
    setSaving(false);
  };

  /* Close an open trade */
  const closeTrade = async (trade: Trade) => {
    const db = getSupabase();
    if (!db || !trade.id) return;
    const exitNum = parseFloat(exitInput);
    if (!exitNum) return;

    const dir = trade.direction === 'LONG' ? 1 : -1;
    let pnl_usd: number | null = null;

    if (trade.position_size_usd && trade.entry_price) {
      const units = trade.position_size_usd / trade.entry_price;
      pnl_usd = (exitNum - trade.entry_price) * units * dir;
    }

    // R-multiple from price levels alone - doesn't need risk_usd (which was
    // often unset - see QA-1), since units cancel out in the true ratio.
    const stopDist = Math.abs(trade.entry_price - trade.stop_loss);
    const pnl_r = stopDist > 0 ? ((exitNum - trade.entry_price) * dir) / stopDist : null;

    let result: TradeResult;
    if (pnl_usd != null) {
      result = pnl_usd > 0.01 ? 'WIN' : pnl_usd < -0.01 ? 'LOSS' : 'BE';
    } else {
      const profitable = (exitNum > trade.entry_price) === (trade.direction === 'LONG');
      result = exitNum === trade.entry_price ? 'BE' : profitable ? 'WIN' : 'LOSS';
    }

    await db.from(T.trades).update({ exit_price: exitNum, result, pnl_usd, pnl_r }).eq('id', trade.id);
    setClosingId(null);
    setExitInput('');
    await loadTrades();
  };

  const deleteTrade = async (id: string) => {
    const db = getSupabase();
    if (!db) return;
    if (!confirm(t('TRADE_JOURNAL_CONFIRM_DELETE_TRADE'))) return;
    await db.from(T.trades).delete().eq('id', id);
    setTrades(prev => prev.filter(tr => tr.id !== id));
  };

  const startEdit = (trade: Trade) => {
    setEditDraft({
      result:     trade.result,
      exit_price: trade.exit_price?.toString() ?? '',
      pnl_usd:    trade.pnl_usd?.toString()   ?? '',
      notes:      trade.notes                  ?? '',
    });
    setEditingId(trade.id ?? null);
  };

  const saveEdit = async (trade: Trade) => {
    const db = getSupabase();
    if (!db || !trade.id) return;
    await db.from(T.trades).update({
      result:     editDraft.result,
      exit_price: editDraft.exit_price ? parseFloat(editDraft.exit_price) : null,
      pnl_usd:    editDraft.pnl_usd    ? parseFloat(editDraft.pnl_usd)    : null,
      notes:      editDraft.notes || null,
    }).eq('id', trade.id);
    setEditingId(null);
    await loadTrades();
  };

  /* Trade history pagination */
  const HISTORY_PAGE_SIZE = 20;
  const historyPageCount = Math.max(1, Math.ceil(trades.length / HISTORY_PAGE_SIZE));
  const historyPageSafe  = Math.min(historyPage, historyPageCount - 1);
  const pagedTrades = trades.slice(historyPageSafe * HISTORY_PAGE_SIZE, historyPageSafe * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);

  /* Stats */
  const stats = useMemo(() => {
    const closed = trades.filter(tr => tr.result !== 'OPEN');
    const wins   = closed.filter(tr => tr.result === 'WIN').length;
    const losses = closed.filter(tr => tr.result === 'LOSS').length;
    const winRate   = closed.length ? (wins / closed.length) * 100 : 0;
    const totalPnL  = closed.reduce((s, tr) => s + (tr.pnl_usd ?? 0), 0);
    const rValues   = closed.map(tradeR).filter((r): r is number => r != null);
    const avgR      = rValues.length ? rValues.reduce((s, r) => s + r, 0) / rValues.length : 0;

    const byCoin: Record<string, { total: number; wins: number; pnl: number }> = {};
    closed.forEach(tr => {
      if (!byCoin[tr.coin]) byCoin[tr.coin] = { total: 0, wins: 0, pnl: 0 };
      byCoin[tr.coin].total++;
      if (tr.result === 'WIN') byCoin[tr.coin].wins++;
      byCoin[tr.coin].pnl += tr.pnl_usd ?? 0;
    });

    const bySetup: Record<string, { total: number; wins: number }> = {};
    closed.forEach(tr => {
      const s = tr.setup_type || 'Other';
      if (!bySetup[s]) bySetup[s] = { total: 0, wins: 0 };
      bySetup[s].total++;
      if (tr.result === 'WIN') bySetup[s].wins++;
    });

    // Streaks - sort closed by created_at ascending
    const chronological = [...closed].sort((a, b) =>
      (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1
    );
    let curStreak = 0, curDir: 'W' | 'L' | null = null;
    let bestWin = 0, bestLoss = 0;
    const cumPnL: { idx: number; value: number }[] = [];
    let running = 0;
    for (let i = 0; i < chronological.length; i++) {
      const tr = chronological[i];
      running += tr.pnl_usd ?? 0;
      cumPnL.push({ idx: i, value: running });

      // BE trades are neutral - skip them for streak tracking
      if (tr.result === 'BE') continue;
      const isWin = tr.result === 'WIN';
      const dir: 'W' | 'L' = isWin ? 'W' : 'L';
      if (dir === curDir) {
        curStreak++;
      } else {
        curDir = dir;
        curStreak = 1;
      }
      if (isWin && curStreak > bestWin)  bestWin  = curStreak;
      if (!isWin && curStreak > bestLoss) bestLoss = curStreak;
    }
    const streak = { current: curStreak, dir: curDir, bestWin, bestLoss };

    return { winRate, totalPnL, avgR, total: trades.length, closed: closed.length, wins, losses, byCoin, bySetup, streak, cumPnL };
  }, [trades]);

  /* No Supabase */
  if (noDb) return (
    <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--txt3)', fontSize: 'var(--fs-label)' }}>
      
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('TRADE_JOURNAL_NO_DB_TITLE')}</div>
      <div>{t('TRADE_JOURNAL_NO_DB_MESSAGE')}</div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>{t('TRADE_JOURNAL_PAGE_TITLE')}</h1>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('TRADE_JOURNAL_PAGE_SUBTITLE')}</div>
      </div>

      {/* Tabs */}
      <div className="tj-tabs">
        <button className={`tj-tab${tab === 'log' ? ' on' : ''}`} onClick={() => setTab('log')}>{t('TRADE_JOURNAL_TAB_LOG')}</button>
        <button className={`tj-tab${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>{t('TRADE_JOURNAL_TAB_HISTORY', { count: trades.length })}</button>
        <button className={`tj-tab${tab === 'stats' ? ' on' : ''}`} onClick={() => setTab('stats')}>{t('TRADE_JOURNAL_TAB_STATS')}</button>
        <button className={`tj-tab${tab === 'rules' ? ' on' : ''}`} onClick={() => setTab('rules')} style={{ position: 'relative' }}>
          {t('TRADE_JOURNAL_TAB_RULES')}{rules.filter(r => r.enabled).length > 0 && (
            <span style={{
              marginLeft: 5, fontSize: 'var(--fs-caption)', fontWeight: 700,
              background: 'var(--accent)', color: '#fff',
              borderRadius: 10, padding: '1px 5px',
            }}>{rules.filter(r => r.enabled).length}</span>
          )}
        </button>
        <button className={`tj-tab${tab === 'shadow' ? ' on' : ''}`} onClick={() => setTab('shadow')}>{t('TRADE_JOURNAL_TAB_SHADOW')}</button>
        <button className={`tj-tab${tab === 'bias' ? ' on' : ''}`} onClick={() => setTab('bias')}>{t('TRADE_JOURNAL_TAB_BIAS')}</button>
        <button className={`tj-tab${tab === 'thesis' ? ' on' : ''}`} onClick={() => setTab('thesis')} style={{ position: 'relative' }}>
          {t('TRADE_JOURNAL_TAB_THESIS')}{theses.length > 0 && (
            <span style={{ marginLeft: 5, fontSize: 'var(--fs-caption)', fontWeight: 700, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 5px' }}>{theses.length}</span>
          )}
        </button>
      </div>

      {/* ──────── LOG TAB ──────── */}
      {tab === 'log' && (
        <div>
          {/* Coin + Direction */}
          <div className="tj-card">
            <div className="tj-card-lbl">{t('TRADE_JOURNAL_LOG_COIN_DIRECTION_LABEL')}</div>
            <div className="tj-coins">
              {COINS.map(c => (
                <button
                  key={c}
                  className={`tj-coin${coin === c ? ' on' : ''}`}
                  onClick={() => setCoin(c)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: coinBadgeColor(c) }} />
                  {c.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="tj-dir-row">
              <button className={`tj-dir-btn${direction === 'LONG' ? ' tj-long' : ''}`} onClick={() => setDirection('LONG')}>▲ {t('TRADE_JOURNAL_LOG_DIR_LONG_BUTTON')}</button>
              <button className={`tj-dir-btn${direction === 'SHORT' ? ' tj-short' : ''}`} onClick={() => setDirection('SHORT')}>▼ {t('TRADE_JOURNAL_LOG_DIR_SHORT_BUTTON')}</button>
            </div>
          </div>

          {/* Setup type */}
          <div className="tj-card">
            <div className="tj-card-lbl">{t('TRADE_JOURNAL_LOG_SETUP_TYPE_LABEL')}</div>
            <div className="tj-setups">
              {SETUPS.map(s => (
                <button key={s} className={`tj-setup-btn${setup === s ? ' on' : ''}`} onClick={() => setSetup(s)}>{s}</button>
              ))}
            </div>
          </div>

          {/* Price levels */}
          <div className="tj-card">
            <div className="tj-card-lbl">{t('TRADE_JOURNAL_LOG_PRICE_LEVELS_LABEL')}</div>
            <div className="tj-price-grid">
              <div className="tj-field">
                <label className="tj-lbl">{t('TRADE_JOURNAL_LOG_ENTRY_LABEL')}</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp" aria-label={t('TRADE_JOURNAL_LOG_ENTRY_ARIA')} type="number" placeholder="0.00" value={entry} onChange={e => setEntry(e.target.value)} />
                </div>
              </div>
              <div className="tj-field">
                <label className="tj-lbl">{t('TRADE_JOURNAL_LOG_STOP_LOSS_LABEL')}</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp tj-inp-stop" aria-label={t('TRADE_JOURNAL_LOG_STOP_LOSS_ARIA')} type="number" placeholder="0.00" value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
                </div>
              </div>
              <div className="tj-field">
                <label className="tj-lbl">{t('TRADE_JOURNAL_LOG_TAKE_PROFIT_LABEL')}</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp tj-inp-tp" aria-label={t('TRADE_JOURNAL_LOG_TAKE_PROFIT_LABEL')} type="number" placeholder="0.00" value={tpPrice} onChange={e => setTpPrice(e.target.value)} />
                </div>
              </div>
              <div className="tj-field">
                <label className="tj-lbl">{t('TRADE_JOURNAL_LOG_POSITION_SIZE_LABEL')}</label>
                <div className="tj-irow"><span className="tj-affix">$</span>
                  <input className="tj-inp" aria-label={t('TRADE_JOURNAL_LOG_POSITION_SIZE_ARIA')} type="number" placeholder={t('TRADE_JOURNAL_LOG_POSITION_SIZE_PLACEHOLDER')} value={posUSD} onChange={e => setPosUSD(e.target.value)} />
                </div>
              </div>
            </div>
            {riskUsd != null && (
              <div className="tj-autofill">
                {t('TRADE_JOURNAL_LOG_RISK_LINE', { amount: riskUsd.toFixed(2) })}{riskFromLevels == null ? ` ${t('TRADE_JOURNAL_LOG_RISK_AUTO_SUFFIX')}` : ''}
              </div>
            )}
          </div>

          {/* Leverage */}
          {(() => {
            const levColor = leverage >= 25 ? '#f87171' : leverage >= 10 ? '#fbbf24' : '#34d399';
            const levPct   = ((leverage - 1) / (125 - 1)) * 100;
            const trackBg  = `linear-gradient(to right, ${levColor} 0%, ${levColor} ${levPct}%, rgba(255,255,255,0.08) ${levPct}%, rgba(255,255,255,0.08) 100%)`;
            return (
              <div className="tj-card">
                <div className="tj-card-lbl" style={{ margin: '0 0 14px' }}>{t('TRADE_JOURNAL_LOG_LEVERAGE_LABEL')}</div>

                {/* Slider */}
                <div className="tj-lev-slider-wrap">
                  <input
                    type="range"
                    className="tj-lev-slider"
                    aria-label={t('TRADE_JOURNAL_LOG_LEVERAGE_LABEL')}
                    min={1} max={125} step={1}
                    value={leverage}
                    onChange={e => setLeverage(Number(e.target.value))}
                    style={{ background: trackBg, color: levColor }}
                  />
                  <div className="tj-lev-ticks">
                    {['1×', '25×', '50×', '75×', '100×', '125×'].map(tick => (
                      <span key={tick}>{tick}</span>
                    ))}
                  </div>
                </div>

                {/* Preset chips + number input */}
                <div className="tj-lev-row">
                  <div className="tj-lev-presets">
                    {[1, 3, 5, 10, 20, 50, 75, 100, 125].map(v => (
                      <button
                        key={v}
                        className={`tj-lev-preset${leverage === v ? ' on' : ''}`}
                        style={leverage === v ? { background: withAlpha(levColor, '18'), color: levColor, borderColor: withAlpha(levColor, '44') } : {}}
                        onClick={() => setLeverage(v)}
                      >
                        {v}×
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    className="tj-lev-num"
                    aria-label={t('TRADE_JOURNAL_LOG_LEVERAGE_VALUE_ARIA')}
                    min={1} max={125}
                    value={leverage}
                    onChange={e => setLeverage(Math.max(1, Math.min(125, parseInt(e.target.value) || 1)))}
                  />
                </div>

                {/* Risk warning */}
                {leverage >= 25 && (
                  <div className="tj-lev-warn" style={{ color: levColor, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Warn />
                    {leverage >= 75
                      ? t('TRADE_JOURNAL_LOG_LEV_WARN_EXTREME')
                      : leverage >= 50
                      ? t('TRADE_JOURNAL_LOG_LEV_WARN_VERY_HIGH')
                      : t('TRADE_JOURNAL_LOG_LEV_WARN_HIGH')}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Notes */}
          <div className="tj-card">
            <div className="tj-card-lbl">{t('TRADE_JOURNAL_LOG_NOTES_LABEL')}</div>
            <textarea
              className="tj-notes"
              aria-label={t('TRADE_JOURNAL_LOG_NOTES_ARIA')}
              rows={3}
              placeholder={t('TRADE_JOURNAL_LOG_NOTES_PLACEHOLDER')}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {levelWarnings.length > 0 && (
            <div style={{
              background: 'rgba(217,119,6,0.08)', border: '0.5px solid rgba(217,119,6,0.3)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 12,
            }}>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#f59e0b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Warn /> {t('TRADE_JOURNAL_LOG_LEVEL_WARNINGS_TITLE')}
              </div>
              {levelWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 'var(--fs-caption)', color: '#f59e0b', opacity: 0.85, lineHeight: 1.5 }}>
                  · {w}
                </div>
              ))}
            </div>
          )}

          {activeViolations.length > 0 && (
            <div style={{
              background: 'rgba(248,113,113,0.08)', border: '0.5px solid rgba(248,113,113,0.3)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 12,
            }}>
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#f87171', marginBottom: 6 }}>
                {t('TRADE_JOURNAL_LOG_RULE_VIOLATION_TITLE', { plural: activeViolations.length > 1 ? 's' : '' })}
              </div>
              {activeViolations.map(r => (
                <div key={r.id} style={{ fontSize: 'var(--fs-caption)', color: '#f87171', opacity: 0.85, lineHeight: 1.5 }}>
                  · {r.name} ({ruleLabel(r, t)})
                </div>
              ))}
            </div>
          )}

          <button className="tj-submit" onClick={saveTrade} disabled={saving || !entry || !stopLoss}>
            {saving
              ? t('TRADE_JOURNAL_LOG_SAVING_BUTTON')
              : activeViolations.length > 0
              ? t('TRADE_JOURNAL_LOG_SUBMIT_WITH_VIOLATIONS', { count: activeViolations.length, plural: activeViolations.length > 1 ? 's' : '' })
              : t('TRADE_JOURNAL_LOG_SUBMIT_BUTTON')}
          </button>
        </div>
      )}

      {/* ──────── HISTORY TAB ──────── */}
      {tab === 'history' && (
        <div>
          {loading && <LoadingState message={t('TRADE_JOURNAL_HISTORY_LOADING_MESSAGE')} />}
          {!loading && trades.length === 0 && (
            <div style={{
              border: '0.5px solid var(--bdr)', borderRadius: 10,
              padding: '24px 20px', margin: '8px 0', textAlign: 'center',
            }}>
              <div style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>
                {t('TRADE_JOURNAL_HISTORY_EMPTY_TITLE')}
              </div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.65, marginBottom: 16, maxWidth: 320, margin: '0 auto 16px' }}>
                {t('TRADE_JOURNAL_HISTORY_EMPTY_DESC')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
                {(['TRADE_JOURNAL_HISTORY_EMPTY_BULLET_PNL', 'TRADE_JOURNAL_HISTORY_EMPTY_BULLET_WINRATE', 'TRADE_JOURNAL_HISTORY_EMPTY_BULLET_BIAS'] as const).map(bulletKey => (
                  <span key={bulletKey} style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
                    {t(bulletKey)}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setTab('log')}
                style={{
                  background: 'var(--accent-bg)', border: '0.5px solid var(--accent-bdr)',
                  color: 'var(--accent)', borderRadius: 8,
                  padding: '9px 20px', fontSize: 'var(--fs-caption)', fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('TRADE_JOURNAL_HISTORY_EMPTY_CTA')} →
              </button>
            </div>
          )}
          {pagedTrades.map(trade => (
            <div key={trade.id} className={`tj-trade tj-trade-${trade.result.toLowerCase()}`}>
              <div className="tj-trade-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="tj-trade-coin" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: coinBadgeColor(trade.coin) }} />
                    {trade.coin.toUpperCase()}
                  </span>
                  <span className={`tj-trade-dir-tag ${trade.direction === 'LONG' ? 'tj-long' : 'tj-short'}`}>
                    {trade.direction === 'LONG' ? '▲' : '▼'} {trade.direction}
                  </span>
                  {trade.leverage != null && trade.leverage > 1 && (
                    <span className="tj-lev-tag" style={{
                      color:       trade.leverage >= 25 ? '#f87171' : trade.leverage >= 10 ? '#fbbf24' : '#34d399',
                      background:  withAlpha(trade.leverage >= 25 ? '#f87171' : trade.leverage >= 10 ? '#fbbf24' : '#34d399', '14'),
                      borderColor: withAlpha(trade.leverage >= 25 ? '#f87171' : trade.leverage >= 10 ? '#fbbf24' : '#34d399', '40'),
                    }}>
                      {trade.leverage}×
                    </span>
                  )}
                  <span className="tj-trade-setup-tag">{trade.setup_type}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`tj-result-badge tj-rb-${trade.result.toLowerCase()}`}>{trade.result}</span>
                  {trade.id && violatingTradeIds.has(trade.id) && (
                    <span title={t('TRADE_JOURNAL_HISTORY_RULE_VIOLATION_TITLE')} style={{
                      fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '0.05em',
                      background: 'rgba(248,113,113,0.12)', color: '#f87171',
                      border: '0.5px solid rgba(248,113,113,0.3)',
                      borderRadius: 4, padding: '2px 5px',
                    }}>{t('TRADE_JOURNAL_HISTORY_RULE_BADGE')}</span>
                  )}
                  <button className="tj-edit-btn" title={t('TRADE_JOURNAL_HISTORY_EDIT_TITLE')} onClick={() => editingId === trade.id ? setEditingId(null) : startEdit(trade)}>✎</button>
                  <button className="tj-del-btn" onClick={() => trade.id && deleteTrade(trade.id)}>✕</button>
                </div>
              </div>

              <div className="tj-trade-prices">
                <div className="tj-tp"><span className="tj-tp-lbl">{t('TRADE_JOURNAL_HISTORY_TP_ENTRY_LABEL')}</span><span className="tj-tp-val">${trade.entry_price.toLocaleString()}</span></div>
                <div className="tj-tp"><span className="tj-tp-lbl">{t('TRADE_JOURNAL_HISTORY_TP_STOP_LABEL')}</span><span className="tj-tp-val" style={{ color: '#f87171' }}>${trade.stop_loss.toLocaleString()}</span></div>
                {trade.take_profit != null && (
                  <div className="tj-tp"><span className="tj-tp-lbl">{t('TRADE_JOURNAL_HISTORY_TP_TP_LABEL')}</span><span className="tj-tp-val" style={{ color: '#34d399' }}>${trade.take_profit.toLocaleString()}</span></div>
                )}
                {trade.exit_price != null && (
                  <div className="tj-tp"><span className="tj-tp-lbl">{t('TRADE_JOURNAL_HISTORY_TP_EXIT_LABEL')}</span><span className="tj-tp-val">${trade.exit_price.toLocaleString()}</span></div>
                )}
                {trade.pnl_usd != null && (
                  <div className="tj-tp">
                    <span className="tj-tp-lbl">{t('TRADE_JOURNAL_HISTORY_TP_PNL_LABEL')}</span>
                    <span className="tj-tp-val" style={{ color: trade.pnl_usd >= 0 ? '#34d399' : '#f87171' }}>
                      {fmtUSD(trade.pnl_usd)}
                    </span>
                  </div>
                )}
                {(() => {
                  const r = tradeR(trade);
                  if (r == null || Math.abs(r) < 0.005) return null;
                  return (
                    <div className="tj-tp">
                      <span className="tj-tp-lbl">{t('TRADE_JOURNAL_HISTORY_TP_R_LABEL')}</span>
                      <span className="tj-tp-val" style={{ color: r >= 0 ? '#34d399' : '#f87171' }}>
                        {r >= 0 ? '+' : ''}{r.toFixed(2)}R
                      </span>
                    </div>
                  );
                })()}
              </div>

              {trade.notes && <div className="tj-trade-notes">{trade.notes}</div>}

              <div className="tj-trade-meta">
                {trade.created_at && <span>{fmtDate(trade.created_at)}</span>}
                {trade.session && <span> · {trade.session}</span>}
              </div>

              {/* Close trade */}
              {trade.result === 'OPEN' && (
                closingId === trade.id ? (
                  <div className="tj-close-row">
                    <div className="tj-irow" style={{ flex: 1 }}>
                      <span className="tj-affix">$</span>
                      <input
                        className="tj-inp"
                        type="number"
                        placeholder={t('TRADE_JOURNAL_HISTORY_EXIT_PRICE_PLACEHOLDER')}
                        value={exitInput}
                        onChange={e => setExitInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && closeTrade(trade)}
                        autoFocus
                      />
                    </div>
                    <button className="tj-confirm-btn" onClick={() => closeTrade(trade)}>✓ {t('TRADE_JOURNAL_HISTORY_CLOSE_CONFIRM_BUTTON')}</button>
                    <button className="tj-cancel-btn" onClick={() => { setClosingId(null); setExitInput(''); }}>{t('TRADE_JOURNAL_HISTORY_CANCEL_BUTTON')}</button>
                  </div>
                ) : (
                  <button className="tj-close-btn" onClick={() => setClosingId(trade.id ?? null)}>
                    {t('TRADE_JOURNAL_HISTORY_CLOSE_TRADE_BUTTON')} →
                  </button>
                )
              )}

              {/* Inline edit form */}
              {editingId === trade.id && (
                <div className="tj-edit-form">
                  <div className="tj-edit-row">
                    <div className="tj-edit-field">
                      <label className="tj-lbl">{t('TRADE_JOURNAL_HISTORY_EDIT_RESULT_LABEL')}</label>
                      <select
                        className="tj-edit-select"
                        value={editDraft.result}
                        onChange={e => setEditDraft(p => ({ ...p, result: e.target.value as TradeResult }))}
                      >
                        {(['OPEN','WIN','LOSS','BE'] as TradeResult[]).map(r => (
                          <option key={r} value={r}>
                            {r === 'OPEN' ? t('TRADE_JOURNAL_HISTORY_RESULT_OPEN')
                              : r === 'WIN' ? t('TRADE_JOURNAL_HISTORY_RESULT_WIN')
                              : r === 'LOSS' ? t('TRADE_JOURNAL_HISTORY_RESULT_LOSS')
                              : t('TRADE_JOURNAL_HISTORY_RESULT_BE')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="tj-edit-field">
                      <label className="tj-lbl">{t('TRADE_JOURNAL_HISTORY_EDIT_EXIT_PRICE_LABEL')}</label>
                      <div className="tj-irow"><span className="tj-affix">$</span>
                        <input className="tj-inp" type="number" placeholder="0.00"
                          value={editDraft.exit_price}
                          onChange={e => setEditDraft(p => ({ ...p, exit_price: e.target.value }))} />
                      </div>
                    </div>
                    <div className="tj-edit-field">
                      <label className="tj-lbl">{t('TRADE_JOURNAL_HISTORY_EDIT_PNL_LABEL')}</label>
                      <div className="tj-irow"><span className="tj-affix">$</span>
                        <input className="tj-inp" type="number" placeholder="0.00"
                          value={editDraft.pnl_usd}
                          onChange={e => setEditDraft(p => ({ ...p, pnl_usd: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                  <div className="tj-edit-field" style={{ marginTop: 8 }}>
                    <label className="tj-lbl">{t('TRADE_JOURNAL_HISTORY_EDIT_NOTES_LABEL')}</label>
                    <textarea className="tj-notes" rows={2}
                      value={editDraft.notes}
                      onChange={e => setEditDraft(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                  <div className="tj-edit-btns">
                    <button className="tj-confirm-btn" onClick={() => saveEdit(trade)}>{t('TRADE_JOURNAL_HISTORY_SAVE_BUTTON')}</button>
                    <button className="tj-cancel-btn" onClick={() => setEditingId(null)}>{t('TRADE_JOURNAL_HISTORY_CANCEL_BUTTON')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Pagination */}
          {trades.length > HISTORY_PAGE_SIZE && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, flexWrap: 'wrap', padding: '14px 2px 0', marginTop: 4,
              borderTop: '0.5px solid var(--bdr)',
            }}>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontFamily: 'var(--font-mono), monospace' }}>
                {t('TRADE_JOURNAL_HISTORY_PAGE_RANGE', {
                  start: historyPageSafe * HISTORY_PAGE_SIZE + 1,
                  end: Math.min(trades.length, historyPageSafe * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE),
                  total: trades.length,
                })}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                  disabled={historyPageSafe === 0}
                  style={{
                    padding: '5px 10px', fontSize: 'var(--fs-caption)', borderRadius: 6,
                    border: '0.5px solid var(--bdr)', background: 'transparent',
                    color: historyPageSafe === 0 ? 'var(--txt3)' : 'var(--txt2)',
                    cursor: historyPageSafe === 0 ? 'default' : 'pointer', opacity: historyPageSafe === 0 ? 0.4 : 1,
                  }}
                >
                  ← {t('TRADE_JOURNAL_HISTORY_PREV_BUTTON')}
                </button>
                {Array.from({ length: historyPageCount }, (_, i) => i).map(i => (
                  <button
                    key={i}
                    onClick={() => setHistoryPage(i)}
                    style={{
                      width: 26, height: 26, fontSize: 'var(--fs-caption)', fontWeight: 700, borderRadius: 6,
                      border: `0.5px solid ${i === historyPageSafe ? 'var(--accent-bdr)' : 'var(--bdr)'}`,
                      background: i === historyPageSafe ? 'var(--accent)' : 'transparent',
                      color: i === historyPageSafe ? '#fff' : 'var(--txt3)',
                      cursor: 'pointer',
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setHistoryPage(p => Math.min(historyPageCount - 1, p + 1))}
                  disabled={historyPageSafe >= historyPageCount - 1}
                  style={{
                    padding: '5px 10px', fontSize: 'var(--fs-caption)', borderRadius: 6,
                    border: '0.5px solid var(--bdr)', background: 'transparent',
                    color: historyPageSafe >= historyPageCount - 1 ? 'var(--txt3)' : 'var(--txt2)',
                    cursor: historyPageSafe >= historyPageCount - 1 ? 'default' : 'pointer', opacity: historyPageSafe >= historyPageCount - 1 ? 0.4 : 1,
                  }}
                >
                  {t('TRADE_JOURNAL_HISTORY_NEXT_BUTTON')} →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──────── RULES TAB ──────── */}
      {tab === 'rules' && (
        <div style={{ paddingTop: 8 }}>

          {/* Header */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{t('TRADE_JOURNAL_RULES_PAGE_TITLE')}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
              {t('TRADE_JOURNAL_RULES_PAGE_SUBTITLE')}
            </div>
          </div>

          {/* Quick-add presets */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 8 }}>{t('TRADE_JOURNAL_RULES_QUICK_ADD_LABEL')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {RULE_PRESETS.map(p => {
                const exists = rules.some(r => r.name === p.name);
                return (
                  <button
                    key={p.name}
                    onClick={() => addPreset(p)}
                    disabled={exists}
                    style={{
                      fontSize: 'var(--fs-caption)', fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                      border: `0.5px solid ${exists ? 'var(--bdr)' : 'var(--accent-bdr)'}`,
                      background: exists ? 'transparent' : 'var(--accent-bg)',
                      color: exists ? 'var(--txt3)' : 'var(--accent)',
                      cursor: exists ? 'default' : 'pointer', opacity: exists ? 0.4 : 1,
                    }}
                  >
                    {exists ? '✓ ' : '+ '}{t(p.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active rules list */}
          {rules.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 8 }}>
                {t('TRADE_JOURNAL_RULES_ACTIVE_RULES_LABEL', { enabled: rules.filter(r => r.enabled).length, total: rules.length })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rules.map(r => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'var(--bg1)', border: `0.5px solid ${r.enabled ? 'var(--bdr)' : 'var(--bdr)'}`,
                    borderRadius: 8, padding: '8px 12px', opacity: r.enabled ? 1 : 0.45,
                  }}>
                    <button
                      onClick={() => toggleRule(r.id)}
                      title={r.enabled ? t('TRADE_JOURNAL_RULES_TOGGLE_DISABLE_TITLE') : t('TRADE_JOURNAL_RULES_TOGGLE_ENABLE_TITLE')}
                      style={{
                        width: 28, height: 16, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
                        background: r.enabled ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                        border: 'none', position: 'relative', transition: 'background 0.15s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 2, left: r.enabled ? 14 : 2,
                        width: 12, height: 12, borderRadius: '50%', background: '#fff',
                        transition: 'left 0.15s',
                      }} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt)', marginBottom: 1 }}>{r.name}</div>
                      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontFamily: 'var(--font-mono), monospace' }}>{ruleLabel(r, t)}</div>
                    </div>
                    <button
                      onClick={() => deleteRule(r.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt3)', fontSize: '0.875rem', padding: '2px 4px', lineHeight: 1 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rules.length === 0 && (
            <div style={{ color: 'var(--txt3)', fontSize: 'var(--fs-caption)', marginBottom: 16 }}>{t('TRADE_JOURNAL_RULES_EMPTY_STATE')}</div>
          )}

          {/* Custom rule form */}
          <button
            onClick={() => setShowRuleForm(v => !v)}
            style={{
              fontSize: 'var(--fs-caption)', fontWeight: 600, padding: '7px 14px', borderRadius: 8,
              border: '0.5px solid var(--bdr)', background: 'transparent',
              color: 'var(--txt2)', cursor: 'pointer', marginBottom: showRuleForm ? 12 : 0,
            }}
          >
            {showRuleForm ? `− ${t('TRADE_JOURNAL_RULES_CANCEL_BUTTON')}` : `+ ${t('TRADE_JOURNAL_RULES_CUSTOM_RULE_BUTTON')}`}
          </button>

          {showRuleForm && (
            <div style={{
              background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 10 }}>{t('TRADE_JOURNAL_RULES_FORM_TITLE')}</div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {/* Field */}
                <select
                  value={ruleField}
                  onChange={e => { setRuleField(e.target.value as RuleField); setRuleValue(''); }}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                >
                  {(Object.entries(RULE_FIELD_LABEL_KEYS) as [RuleField, LabelKey][]).map(([k, v]) => (
                    <option key={k} value={k}>{t(v)}</option>
                  ))}
                </select>

                {/* Operator */}
                <select
                  value={ruleOp}
                  onChange={e => setRuleOp(e.target.value as RuleOperator)}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                >
                  {(ruleField === 'leverage'
                    ? (['lte', 'gte'] as RuleOperator[])
                    : (['is', 'is_not'] as RuleOperator[])
                  ).map(op => (
                    <option key={op} value={op}>{t(RULE_OP_LABEL_KEYS[op])}</option>
                  ))}
                </select>

                {/* Value - context-sensitive */}
                {ruleField === 'coin' && (
                  <select
                    value={ruleValue}
                    onChange={e => setRuleValue(e.target.value)}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                  >
                    <option value="">{t('TRADE_JOURNAL_RULES_SELECT_COIN_PLACEHOLDER')}</option>
                    {COINS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                  </select>
                )}
                {ruleField === 'direction' && (
                  <select
                    value={ruleValue}
                    onChange={e => setRuleValue(e.target.value)}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                  >
                    <option value="">{t('TRADE_JOURNAL_RULES_SELECT_DIRECTION_PLACEHOLDER')}</option>
                    <option value="LONG">{t('TRADE_JOURNAL_RULES_DIRECTION_LONG')}</option>
                    <option value="SHORT">{t('TRADE_JOURNAL_RULES_DIRECTION_SHORT')}</option>
                  </select>
                )}
                {ruleField === 'setup_type' && (
                  <select
                    value={ruleValue}
                    onChange={e => setRuleValue(e.target.value)}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                  >
                    <option value="">{t('TRADE_JOURNAL_RULES_SELECT_SETUP_PLACEHOLDER')}</option>
                    {SETUPS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {ruleField === 'session' && (
                  <select
                    value={ruleValue}
                    onChange={e => setRuleValue(e.target.value)}
                    style={{ padding: '6px 8px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                  >
                    <option value="">{t('TRADE_JOURNAL_RULES_SELECT_SESSION_PLACEHOLDER')}</option>
                    {SESSIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {ruleField === 'leverage' && (
                  <input
                    type="number" min={1} max={125}
                    value={ruleValue}
                    onChange={e => setRuleValue(e.target.value)}
                    placeholder={t('TRADE_JOURNAL_RULES_LEVERAGE_PLACEHOLDER')}
                    style={{ width: 70, padding: '6px 8px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)' }}
                  />
                )}
              </div>

              <input
                type="text"
                placeholder={t('TRADE_JOURNAL_RULES_NAME_PLACEHOLDER')}
                value={ruleName}
                onChange={e => setRuleName(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', marginBottom: 10, outline: 'none' }}
              />

              <button
                disabled={!ruleValue || !ruleName.trim()}
                onClick={() => {
                  if (!ruleValue || !ruleName.trim()) return;
                  addRule({ name: ruleName.trim(), field: ruleField, operator: ruleOp, value: ruleValue, enabled: true });
                  setRuleName(''); setRuleValue(''); setShowRuleForm(false);
                }}
                style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 'var(--fs-caption)', fontWeight: 700, cursor: 'pointer',
                  background: !ruleValue || !ruleName.trim() ? 'rgba(255,255,255,0.04)' : 'var(--accent-bg)',
                  color: !ruleValue || !ruleName.trim() ? 'var(--txt3)' : 'var(--accent)',
                  border: `0.5px solid ${!ruleValue || !ruleName.trim() ? 'var(--bdr)' : 'var(--accent-bdr)'}`,
                }}
              >
                {t('TRADE_JOURNAL_RULES_ADD_RULE_BUTTON')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ──────── SHADOW ACCOUNT TAB ──────── */}
      {tab === 'shadow' && (
        <div>
          <div style={{ padding: '12px 0 16px' }}>
            <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{t('TRADE_JOURNAL_SHADOW_PAGE_TITLE')}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 16, maxWidth: 520 }}>
              {t('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE')}
            </div>
            {!shadowAnalysis && (
              <button
                onClick={runShadowAccount}
                disabled={shadowLoading}
                style={{
                  background: shadowLoading ? 'rgba(255,255,255,0.06)' : 'rgba(26,122,255,0.12)',
                  color: shadowLoading ? 'var(--txt3)' : '#1a7aff',
                  border: `1px solid ${shadowLoading ? 'var(--bdr)' : 'rgba(26,122,255,0.35)'}`,
                  borderRadius: 8, padding: '10px 20px', fontSize: 'var(--fs-label)', fontWeight: 700,
                  cursor: shadowLoading ? 'default' : 'pointer',
                }}
              >
                {shadowLoading ? t('TRADE_JOURNAL_SHADOW_ANALYZING_BUTTON') : t('TRADE_JOURNAL_SHADOW_ANALYZE_BUTTON')}
              </button>
            )}
            {shadowAnalysis && (
              <button
                onClick={() => { setShadowAnalysis(null); setShadowError(null); }}
                style={{
                  background: 'transparent', color: 'var(--txt3)',
                  border: '0.5px solid var(--bdr)', borderRadius: 6,
                  padding: '6px 12px', fontSize: 'var(--fs-caption)', cursor: 'pointer', marginBottom: 16,
                }}
              >
                {t('TRADE_JOURNAL_SHADOW_RERUN_BUTTON')}
              </button>
            )}
            {shadowError && (
              <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginTop: 8 }}>{shadowError}</div>
            )}
          </div>

          {shadowAnalysis && <ShadowAccountResult text={shadowAnalysis} />}
        </div>
      )}

      {/* ──────── BIAS DIAGNOSTICS TAB ──────── */}
      {tab === 'bias' && (
        <div>
          <div style={{ padding: '12px 0 16px' }}>
            <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{t('TRADE_JOURNAL_BIAS_PAGE_TITLE')}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 16, maxWidth: 520 }}>
              {t('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE')}
            </div>
            {!biasAnalysis && (
              <button
                onClick={runBiasAnalysis}
                disabled={biasLoading}
                style={{
                  background: biasLoading ? 'rgba(255,255,255,0.06)' : 'rgba(26,122,255,0.12)',
                  color: biasLoading ? 'var(--txt3)' : '#1a7aff',
                  border: `1px solid ${biasLoading ? 'var(--bdr)' : 'rgba(26,122,255,0.35)'}`,
                  borderRadius: 8, padding: '10px 20px', fontSize: 'var(--fs-label)', fontWeight: 700,
                  cursor: biasLoading ? 'default' : 'pointer',
                }}
              >
                {biasLoading ? t('TRADE_JOURNAL_BIAS_ANALYZING_BUTTON') : t('TRADE_JOURNAL_BIAS_RUN_BUTTON')}
              </button>
            )}
            {biasAnalysis && (
              <button
                onClick={() => { setBiasAnalysis(null); setBiasError(null); }}
                style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '6px 12px', fontSize: 'var(--fs-caption)', cursor: 'pointer', marginBottom: 16 }}
              >
                {t('TRADE_JOURNAL_BIAS_RERUN_BUTTON')}
              </button>
            )}
            {biasError && (
              <div style={{ color: '#f87171', fontSize: 'var(--fs-caption)', marginTop: 8 }}>{biasError}</div>
            )}
          </div>
          {biasAnalysis && <BiasResult text={biasAnalysis} />}
        </div>
      )}

      {/* ──────── THESIS TRACKER TAB ──────── */}
      {tab === 'thesis' && (
        <div>
          <div style={{ padding: '12px 0 4px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-data)', fontWeight: 700, color: 'var(--txt)', marginBottom: 4 }}>{t('TRADE_JOURNAL_THESIS_PAGE_TITLE')}</div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', maxWidth: 480 }}>
                {t('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE')}
              </div>
            </div>
            <button
              onClick={() => setShowThesisForm(v => !v)}
              style={{
                background: showThesisForm ? 'rgba(255,255,255,0.06)' : 'rgba(26,122,255,0.12)',
                color: showThesisForm ? 'var(--txt3)' : '#1a7aff',
                border: `1px solid ${showThesisForm ? 'var(--bdr)' : 'rgba(26,122,255,0.35)'}`,
                borderRadius: 8, padding: '8px 16px', fontSize: 'var(--fs-caption)', fontWeight: 700, cursor: 'pointer', flexShrink: 0,
              }}
            >
              {showThesisForm ? t('TRADE_JOURNAL_THESIS_CANCEL_BUTTON') : t('TRADE_JOURNAL_THESIS_NEW_BUTTON')}
            </button>
          </div>

          {/* New thesis form */}
          {showThesisForm && (
            <div style={{ background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 'var(--radius-card)', padding: '14px', marginBottom: 16, marginTop: 12 }}>
              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>{t('TRADE_JOURNAL_THESIS_FORM_TITLE')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <input
                  value={thesisFormSymbol}
                  onChange={e => setThesisFormSymbol(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                  placeholder={t('TRADE_JOURNAL_THESIS_TICKER_PLACEHOLDER')}
                  maxLength={10}
                  style={{ width: 110, padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', outline: 'none', fontFamily: 'var(--font-mono), monospace', fontWeight: 700 }}
                />
                <select
                  value={thesisFormDirection}
                  onChange={e => setThesisFormDirection(e.target.value as 'LONG' | 'SHORT')}
                  style={{ padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                >
                  <option value="LONG">{t('TRADE_JOURNAL_THESIS_DIRECTION_LONG')}</option>
                  <option value="SHORT">{t('TRADE_JOURNAL_THESIS_DIRECTION_SHORT')}</option>
                </select>
                <input
                  type="date"
                  value={thesisFormDate}
                  onChange={e => setThesisFormDate(e.target.value)}
                  style={{ padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', outline: 'none' }}
                />
              </div>
              <textarea
                value={thesisFormText}
                onChange={e => setThesisFormText(e.target.value)}
                placeholder={t('TRADE_JOURNAL_THESIS_TEXT_PLACEHOLDER')}
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', resize: 'vertical', outline: 'none', marginBottom: 10 }}
              />
              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                {t('TRADE_JOURNAL_THESIS_ASSUMPTIONS_LABEL')}
              </div>
              {thesisFormAssumptions.map((a, i) => (
                <input
                  key={i}
                  value={a}
                  onChange={e => {
                    const copy = [...thesisFormAssumptions];
                    copy[i] = e.target.value;
                    setThesisFormAssumptions(copy);
                  }}
                  placeholder={t('TRADE_JOURNAL_THESIS_ASSUMPTION_PLACEHOLDER', { n: i + 1 })}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '0.5px solid var(--bdr)', background: 'var(--bg2)', color: 'var(--txt)', fontSize: 'var(--fs-caption)', outline: 'none', marginBottom: 6 }}
                />
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {thesisFormAssumptions.length < 5 && (
                  <button
                    onClick={() => setThesisFormAssumptions(a => [...a, ''])}
                    style={{ fontSize: 'var(--fs-caption)', color: '#1a7aff', background: 'transparent', border: '0.5px solid rgba(26,122,255,0.3)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
                  >
                    {t('TRADE_JOURNAL_THESIS_ADD_ASSUMPTION_BUTTON')}
                  </button>
                )}
                {thesisFormAssumptions.length > 1 && (
                  <button
                    onClick={() => setThesisFormAssumptions(a => a.slice(0, -1))}
                    style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', background: 'transparent', border: '0.5px solid var(--bdr)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
                  >
                    {t('TRADE_JOURNAL_THESIS_REMOVE_LAST_BUTTON')}
                  </button>
                )}
              </div>
              <button
                onClick={addThesis}
                disabled={!thesisFormSymbol.trim() || !thesisFormText.trim() || !thesisFormAssumptions.some(a => a.trim())}
                style={{
                  display: 'block', marginTop: 14, width: '100%',
                  background: 'rgba(26,122,255,0.12)', color: '#1a7aff',
                  border: '1px solid rgba(26,122,255,0.35)', borderRadius: 8,
                  padding: '10px', fontSize: 'var(--fs-label)', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t('TRADE_JOURNAL_THESIS_SAVE_BUTTON')}
              </button>
            </div>
          )}

          {/* Thesis list */}
          {theses.length === 0 && !showThesisForm && (
            <div className="tj-empty-state" style={{ marginTop: 16 }}>{t('TRADE_JOURNAL_THESIS_EMPTY_STATE')}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {theses.map(thesis => {
              const score     = thesis.lastScore;
              const scoreCol  = score == null ? 'var(--txt3)' : score >= 8 ? '#34d399' : score >= 5 ? '#fbbf24' : '#f87171';
              const isChecking = checkingThesisId === thesis.id;
              return (
                <div key={thesis.id} style={{ background: 'var(--bg1)', border: '0.5px solid var(--bdr)', borderRadius: 'var(--radius-card)', padding: '12px 14px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--fs-label)', fontWeight: 800, color: 'var(--txt)', fontFamily: 'var(--font-mono), monospace' }}>{thesis.symbol}</span>
                    <span style={{
                      fontSize: 'var(--fs-caption)', padding: '2px 6px', borderRadius: 10, fontWeight: 700,
                      background: thesis.direction === 'LONG' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                      color: thesis.direction === 'LONG' ? '#34d399' : '#f87171',
                      border: `0.5px solid ${thesis.direction === 'LONG' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
                    }}>
                      {thesis.direction}
                    </span>
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('TRADE_JOURNAL_THESIS_ENTRY_DATE_LABEL', { date: thesis.entryDate })}</span>
                    {score != null && (
                      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: scoreCol, fontFamily: 'var(--font-mono), monospace', marginLeft: 'auto' }}>
                        {score}/10
                      </span>
                    )}
                  </div>

                  {/* Thesis text */}
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.5, marginBottom: 8 }}>{thesis.thesisText}</div>

                  {/* Assumptions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
                    {thesis.assumptions.map((a, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', flexShrink: 0, marginTop: 1 }}>A{i + 1}</span>
                        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{a}</span>
                      </div>
                    ))}
                  </div>

                  {/* Grok feedback */}
                  {thesis.lastFeedback && (
                    <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 10, marginBottom: 10 }}>
                      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                        {t('TRADE_JOURNAL_THESIS_LAST_CHECKED_LABEL', { date: thesis.lastScoreDate ?? '' })}
                      </div>
                      {THESIS_CHECK_SECTIONS.map(({ key, labelKey, color }) => {
                        const content = parseThesisSection(thesis.lastFeedback!, key);
                        if (!content) return null;
                        return (
                          <div key={key} style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: color ?? 'var(--txt3)', marginBottom: 3 }}>{t(labelKey)}</div>
                            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{content}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => checkThesisHealth(thesis)}
                      disabled={isChecking}
                      style={{
                        background: isChecking ? 'rgba(255,255,255,0.06)' : 'rgba(26,122,255,0.10)',
                        color: isChecking ? 'var(--txt3)' : '#1a7aff',
                        border: `0.5px solid ${isChecking ? 'var(--bdr)' : 'rgba(26,122,255,0.3)'}`,
                        borderRadius: 6, padding: '5px 12px', fontSize: 'var(--fs-caption)', fontWeight: 700, cursor: isChecking ? 'default' : 'pointer',
                      }}
                    >
                      {isChecking ? t('TRADE_JOURNAL_THESIS_CHECKING_BUTTON') : thesis.lastFeedback ? t('TRADE_JOURNAL_THESIS_RECHECK_BUTTON') : t('TRADE_JOURNAL_THESIS_CHECK_HEALTH_BUTTON')}
                    </button>
                    <button
                      onClick={() => deleteThesis(thesis.id)}
                      style={{ background: 'transparent', color: 'var(--txt3)', border: '0.5px solid var(--bdr)', borderRadius: 6, padding: '5px 10px', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}
                    >
                      {t('TRADE_JOURNAL_THESIS_DELETE_BUTTON')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ──────── STATS TAB ──────── */}
      {tab === 'stats' && (
        <div>
          {stats.closed === 0 ? (
            <div className="tj-empty-state">{t('TRADE_JOURNAL_STATS_EMPTY_STATE')}</div>
          ) : (
            <>
              {complianceScore && (
                <div style={{
                  background: complianceScore.pct >= 80 ? 'rgba(52,211,153,0.07)' : complianceScore.pct >= 60 ? 'rgba(251,191,36,0.07)' : 'rgba(248,113,113,0.07)',
                  border: `0.5px solid ${complianceScore.pct >= 80 ? 'rgba(52,211,153,0.25)' : complianceScore.pct >= 60 ? 'rgba(251,191,36,0.25)' : 'rgba(248,113,113,0.25)'}`,
                  borderRadius: 'var(--radius-card)', padding: '10px 14px', marginBottom: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 2 }}>{t('TRADE_JOURNAL_STATS_RULE_COMPLIANCE_LABEL')}</div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('TRADE_JOURNAL_STATS_RULE_COMPLIANCE_DESC', { clean: complianceScore.clean, total: complianceScore.total })}</div>
                  </div>
                  <div style={{
                    fontSize: '1.625rem', fontWeight: 800, fontFamily: 'var(--font-mono), monospace',
                    color: complianceScore.pct >= 80 ? '#34d399' : complianceScore.pct >= 60 ? '#fbbf24' : '#f87171',
                  }}>
                    {complianceScore.pct}%
                  </div>
                </div>
              )}

              <div className="tj-stats-grid">
                <div className="tj-stat">
                  <div className="tj-stat-lbl"><Tip width={230} text={t('TRADE_JOURNAL_STATS_WIN_RATE_TOOLTIP')}>{t('TRADE_JOURNAL_STATS_WIN_RATE_LABEL')}</Tip></div>
                  <div className="tj-stat-val" style={{ color: stats.winRate >= 50 ? '#34d399' : '#f87171' }}>
                    {stats.winRate.toFixed(0)}%
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl">{t('TRADE_JOURNAL_STATS_TOTAL_PNL_LABEL')}</div>
                  <div className="tj-stat-val" style={{ color: stats.totalPnL >= 0 ? '#34d399' : '#f87171' }}>
                    {fmtUSD(stats.totalPnL)}
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl"><Tip width={230} text={t('TRADE_JOURNAL_STATS_AVG_R_TOOLTIP')}>{t('TRADE_JOURNAL_STATS_AVG_R_LABEL')}</Tip></div>
                  <div className="tj-stat-val" style={{ color: stats.avgR >= 0 ? '#34d399' : '#f87171' }}>
                    {stats.avgR >= 0 ? '+' : ''}{stats.avgR.toFixed(2)}R
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl">{t('TRADE_JOURNAL_STATS_RECORD_LABEL')}</div>
                  <div className="tj-stat-val">
                    <span style={{ color: '#34d399' }}>{stats.wins}W</span>
                    <span style={{ color: 'var(--txt3)' }}> · </span>
                    <span style={{ color: '#f87171' }}>{stats.losses}L</span>
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl">{t('TRADE_JOURNAL_STATS_CURRENT_STREAK_LABEL')}</div>
                  <div className="tj-stat-val" style={{ color: stats.streak.dir === 'W' ? '#34d399' : stats.streak.dir === 'L' ? '#f87171' : 'var(--txt3)' }}>
                    {stats.streak.dir === 'W' ? `${stats.streak.current}W` : stats.streak.dir === 'L' ? `${stats.streak.current}L` : '-'}
                  </div>
                </div>
                <div className="tj-stat">
                  <div className="tj-stat-lbl">{t('TRADE_JOURNAL_STATS_BEST_WIN_STREAK_LABEL')}</div>
                  <div className="tj-stat-val" style={{ color: stats.streak.bestWin > 0 ? '#34d399' : 'var(--txt3)' }}>
                    {stats.streak.bestWin > 0 ? `${stats.streak.bestWin}W` : '-'}
                  </div>
                </div>
              </div>

              {/* P&L Equity Curve */}
              {stats.cumPnL.length >= 2 && (() => {
                const pts  = stats.cumPnL;
                const minV = Math.min(0, ...pts.map(p => p.value));
                const maxV = Math.max(0, ...pts.map(p => p.value));
                const range = maxV - minV || 1;
                const W = 300, H = 56, PAD = 4;
                const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
                const y = (v: number) => H - PAD - ((v - minV) / range) * (H - PAD * 2);
                const polyline = pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
                const lastV    = pts[pts.length - 1].value;
                const lineCol  = lastV >= 0 ? '#34d399' : '#f87171';
                const zeroY    = y(0);
                return (
                  <div className="tj-breakdown" style={{ marginBottom: 0 }}>
                    <div className="tj-breakdown-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{t('TRADE_JOURNAL_STATS_EQUITY_CURVE_LABEL')}</span>
                      <span style={{ color: lastV >= 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                        {lastV >= 0 ? '+' : ''}{lastV.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 60, display: 'block' }}>
                      {/* Zero baseline */}
                      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      {/* Curve fill */}
                      <polyline
                        points={`${x(0)},${zeroY} ${polyline} ${x(pts.length - 1)},${zeroY}`}
                        fill={withAlpha(lineCol, '18')} stroke="none"
                      />
                      {/* Curve line */}
                      <polyline points={polyline} fill="none" stroke={lineCol} strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </div>
                );
              })()}

              {Object.keys(stats.byCoin).length > 0 && (
                <div className="tj-breakdown">
                  <div className="tj-breakdown-title">{t('TRADE_JOURNAL_STATS_PERFORMANCE_BY_COIN_LABEL')}</div>
                  {Object.entries(stats.byCoin).sort(([,a],[,b]) => b.pnl - a.pnl).map(([c, d]) => {
                    const wr = d.total > 0 ? (d.wins / d.total) * 100 : 0;
                    return (
                    <div key={c} className="tj-breakdown-row">
                      <span className="tj-breakdown-name">{c.toUpperCase()}</span>
                      <div className="tj-breakdown-bar-wrap">
                        <div className="tj-breakdown-bar" style={{ width: `${wr}%` }} />
                      </div>
                      <span className="tj-breakdown-sub">{wr.toFixed(0)}% · {d.wins}/{d.total}</span>
                      <span className="tj-breakdown-pnl" style={{ color: d.pnl >= 0 ? '#34d399' : '#f87171' }}>{fmtUSD(d.pnl)}</span>
                    </div>
                    );
                  })}
                </div>
              )}

              {Object.keys(stats.bySetup).length > 0 && (
                <div className="tj-breakdown">
                  <div className="tj-breakdown-title">{t('TRADE_JOURNAL_STATS_PERFORMANCE_BY_SETUP_LABEL')}</div>
                  {Object.entries(stats.bySetup).sort(([,a],[,b]) => (b.wins/b.total) - (a.wins/a.total)).map(([s, d]) => (
                    <div key={s} className="tj-breakdown-row">
                      <span className="tj-breakdown-name">{s}</span>
                      <span className="tj-breakdown-sub">{t('TRADE_JOURNAL_STATS_TRADES_COUNT', { wins: d.wins, total: d.total })}</span>
                      <span className="tj-breakdown-pnl" style={{ color: (d.wins/d.total) >= 0.5 ? '#34d399' : '#f87171' }}>
                        {((d.wins/d.total)*100).toFixed(0)}% WR
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* Suspense wrapper required for useSearchParams in App Router */
export default function TradeJournal() {
  const { t } = useLabels();
  return (
    <AuthGate
      title={t('TRADE_JOURNAL_AUTH_TITLE')}
      desc={t('TRADE_JOURNAL_AUTH_DESC')}
    >
      <Suspense fallback={<LoadingState message={t('TRADE_JOURNAL_LOADING_MESSAGE')} fullPage />}>
        <Inner />
      </Suspense>
    </AuthGate>
  );
}
