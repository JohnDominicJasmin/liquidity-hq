'use client';
import { OverviewCard, CronsCard, AiCostCard, AccuracyCard, SpikeBanner } from './_cards';
import styles from './ops.module.css';

export default function OpsPage() {
  return (
    <div className={styles.grid}>
      <SpikeBanner />
      <OverviewCard />
      <CronsCard />
      <AiCostCard />
      <AccuracyCard />
    </div>
  );
}
