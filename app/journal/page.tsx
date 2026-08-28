'use client';
import { useDesignMode } from '@/components/DesignModeProvider';
import TradeJournal from '@/components/TradeJournal';
import PageHint from '@/components/PageHint';
import { useLabels } from '@/lib/labels';

export default function JournalPage() {
  const mode = useDesignMode();
  const { t } = useLabels();
  return (
    <div className={mode === 'terminal' ? 'journal-term-wrap' : undefined}>
      <PageHint
        pageKey="journal"
        title={t('JOURNAL_HINT_TITLE')}
        body={t('JOURNAL_HINT_BODY')}
      />
      <TradeJournal />
    </div>
  );
}
