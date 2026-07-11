'use client';
import TradeJournal from '@/components/TradeJournal';
import PageHint from '@/components/PageHint';

export default function JournalPage() {
  return (
    <>
      <PageHint
        pageKey="journal"
        title="Trade Journal"
        body="Log every trade you take, then review your win rate, streak, and patterns over time. The more you log, the clearer your edge becomes."
      />
      <TradeJournal />
    </>
  );
}
