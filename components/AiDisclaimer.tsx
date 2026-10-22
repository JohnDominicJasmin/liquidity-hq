'use client';
import { useLabels } from '@/lib/labels';

/* #1631 item 1, the user-visible half. The server half is the guardrail injected into every xAI system prompt (lib/aiGuardrail.ts);
 * neither substitutes for the other. The guardrail stops the model promising a profit. This tells the reader what they are looking at
 * even when the model behaves - which is the case the guardrail cannot cover, because a well-behaved confident directional call still
 * needs to be read as a model's opinion.
 *
 * THE WORDING IS THE OWNER'S OWN SENTENCE, written by him after rejecting both options he was offered. One grammar correction was
 * put to him and approved; nothing else. DO NOT reword it, shorten it, or tidy it in review - if it has to change, it goes back to
 * him. It also, deliberately, does not say "AI-generated": his sentence does the not-advice job only, which was the point of #1631
 * item 1. Each surface it appears on must therefore identify itself as model output on its own - Arena's "AI Read" eyebrow, the
 * briefing's "AI Pre-Session Briefing" heading, the "GROK" byline in chat and on a hypothesis verdict.
 *
 * ONE COMPONENT, not a string pasted per surface. The wording is legal-adjacent copy the owner personally approved; if it lives in
 * five places it drifts in five places, and the next person editing one panel changes what the product claims on that panel alone.
 *
 * A FOOTNOTE, not a banner. It sits under the answer it qualifies, in caption type, because it is a property of that claim rather
 * than a notice about the site. A banner is read once and then never again; this has to be next to the number.
 *
 * Its own label key rather than reusing ABOUT_REMINDER_TITLE ("Not financial advice"): that one is the About page's heading, and
 * borrowing it would couple two unrelated surfaces so that editing the About copy silently rewrote every AI panel.
 */
export default function AiDisclaimer({ style }: { style?: React.CSSProperties }) {
  const { t } = useLabels();
  return (
    <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--txt3)', marginTop: 6, ...style }}>
      {t('AI_DISCLAIMER')}
    </div>
  );
}
