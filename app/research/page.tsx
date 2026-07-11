'use client';
import HypothesisTracker from '@/components/HypothesisTracker';
import PageHint from '@/components/PageHint';

export default function ResearchPage() {
  return (
    <>
      <PageHint
        pageKey="research"
        title="Research Hypothesis Tracker"
        body="Build structured market theses with measurable acceptance criteria. Add supporting or contradicting evidence over time, then let Grok evaluate whether your hypothesis holds up."
      />
      <HypothesisTracker />
    </>
  );
}
