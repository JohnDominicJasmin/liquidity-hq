'use client';
import { OverviewCard, CronsCard, AiCostCard, AccuracyCard, SpikeBanner, ApiHealthCard } from './_cards';
import styles from './ops.module.css';

export default function OpsPage() {
  return (
    <div className={styles.grid}>
      <SpikeBanner />
      <OverviewCard />
      <CronsCard />
      {/* Directly under the cron card: that one reports whether our own jobs
          are running, this one whether the things they depend on are alive. */}
      <ApiHealthCard />
      <AiCostCard />
      <AccuracyCard />
    </div>
  );
}
