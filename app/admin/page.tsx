'use client';
import { OverviewCard, CronsCard, AiCostCard, AccuracyCard } from './_cards';
import styles from './admin.module.css';

export default function AdminPage() {
  return (
    <div className={styles.grid}>
      <OverviewCard />
      <CronsCard />
      <AiCostCard />
      <AccuracyCard />
    </div>
  );
}
