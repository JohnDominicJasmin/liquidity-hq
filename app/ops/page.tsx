'use client';
import { OverviewCard, CronsCard, AiCostCard, AccuracyCard } from './_cards';
import styles from './ops.module.css';

export default function OpsPage() {
  return (
    <div className={styles.grid}>
      <OverviewCard />
      <CronsCard />
      <AiCostCard />
      <AccuracyCard />
    </div>
  );
}
