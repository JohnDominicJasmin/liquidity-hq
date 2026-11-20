'use client';
import LoadingState from '@/components/LoadingState';
import { useLabels } from '@/lib/labels';

export default function Loading() {
  const { t } = useLabels();
  return <LoadingState message={t('FUNDING_PAGE_LOADING')} fullPage />;
}
