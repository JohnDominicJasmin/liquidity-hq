'use client';
import TradeJournal from '@/components/TradeJournal';
import PageHint from '@/components/PageHint';
import { useLabels } from '@/lib/labels';

export default function JournalPage() {
  const { t } = useLabels();
  return (
    <div className="journal-term-wrap">
      <PageHint
        pageKey="journal"
        title={t('JOURNAL_HINT_TITLE')}
        body={t('JOURNAL_HINT_BODY')}
      />
      <TradeJournal />
    </div>
  );
}
