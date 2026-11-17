'use client';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

/* THE PAGE'S ONE h1, for a page whose visible heading is not an h1 (or has none): screen-reader-only, in the reader's language (SEO + accessibility quick wins, #1185). */
export default function PageH1({ labelKey }: { labelKey: LabelKey }) {
  const { t } = useLabels();
  return <h1 className="sr-only">{t(labelKey)}</h1>;
}
