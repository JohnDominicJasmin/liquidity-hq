'use client';
import { useLabels } from '@/lib/labels';

/* A READING THAT IS NOT HERE SAYS WHICH KIND OF NOT (#1651, PM): still coming (an ellipsis) or not available (the plain word, cause on hover).
   Never a bare dash. Shared by the dashboard's coin cards and the Arena rail's CoinMarketSnapshot, which each had a bare "-" for the same gap. */
export default function ReadingGap({ loading }: { loading: boolean }) {
  const { t } = useLabels();
  if (loading) return <span role="img" aria-label={t('ARENA_SCANNER_LOADING_TITLE')} title={t('ARENA_SCANNER_LOADING_TITLE')}>{'\u2026'}</span>;
  return <span title={t('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE')}>{t('ARENA_SCANNER_UNAVAILABLE')}</span>;
}
