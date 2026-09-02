/* Parsing for the AI briefing's structured payload (#620).
 *
 * /api/briefing used to return three headerless paragraphs, and both briefing
 * renderers did `brief.split('\n\n')`. The canvas (Briefing.dc.html) draws a
 * headline, a four-item meta row and three head+body sections, so the prompt
 * now asks for that shape as JSON.
 *
 * The stored value in sessionStorage stays the RAW model reply, unchanged, so
 * a brief cached before this shipped still restores and still renders. That
 * makes parsing a read-time concern rather than a storage migration, and it
 * is why this lives here instead of in either component: both call it, and
 * the two files already carry a comment admitting their helpers are
 * duplicates of each other.
 *
 * Nothing here invents content. An unparseable reply yields no headline, no
 * meta and no section heads - only the paragraphs it actually contains. The
 * renderers are expected to omit those regions rather than fill them, because
 * a synthesised headline is an editorial claim about the market that the
 * model did not make. */

export interface BriefSection { head: string; body: string }
/** The canvas draws each meta cell as a label above a value, not a bare
 *  string - Briefing.dc.html:56-61. */
export interface BriefMeta { label: string; value: string }

export interface ParsedBrief {
  /** null when the reply was not structured - render no headline, do not derive one. */
  headline: string | null;
  /** Empty when absent. Never padded to a fixed length - the canvas draws four,
   *  but a reply with three renders three rather than one with a blank cell. */
  meta: BriefMeta[];
  /** Empty when the reply was not structured. */
  sections: BriefSection[];
  /** Always populated when there is any text at all: section bodies when
   *  structured, the raw reply split on blank lines otherwise. This is what
   *  keeps the current design rendering prose exactly as it did before. */
  paragraphs: string[];
}

const EMPTY: ParsedBrief = { headline: null, meta: [], sections: [], paragraphs: [] };

export function parseBrief(raw: string | null | undefined): ParsedBrief {
  const text = (raw ?? '').trim();
  if (!text) return EMPTY;

  // A fenced block is the model's common deviation from "reply with only
  // JSON" and is cheap to survive. Anything beyond that is treated as prose.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  if (candidate.startsWith('{')) {
    try {
      const p = JSON.parse(candidate) as {
        headline?: unknown; meta?: unknown; sections?: unknown;
      };
      const sections = Array.isArray(p.sections)
        ? p.sections.filter(
            (s): s is BriefSection =>
              !!s && typeof s === 'object' &&
              typeof (s as BriefSection).head === 'string' &&
              typeof (s as BriefSection).body === 'string',
          ).map(s => ({ head: s.head.trim(), body: s.body.trim() }))
        : [];

      if (typeof p.headline === 'string' && sections.length > 0) {
        return {
          headline: p.headline.trim() || null,
          meta: Array.isArray(p.meta)
            ? p.meta.filter(
                (m): m is BriefMeta =>
                  !!m && typeof m === 'object' &&
                  typeof (m as BriefMeta).label === 'string' &&
                  typeof (m as BriefMeta).value === 'string',
              ).map(m => ({ label: m.label.trim(), value: m.value.trim() }))
               .filter(m => m.label && m.value)
            : [],
          sections,
          paragraphs: sections.map(s => s.body).filter(Boolean),
        };
      }
    } catch { /* fall through to prose */ }
  }

  // Not structured: prose, exactly as the previous contract produced. No
  // headline is manufactured from the first line or sentence.
  return { ...EMPTY, paragraphs: text.split('\n\n').map(s => s.trim()).filter(Boolean) };
}
