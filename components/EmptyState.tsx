/** Shared empty-state placeholder (item #25) - wraps the .empty-state CSS
    convention that TradeJournal/DistributionTracker/alerts already used
    ad-hoc, so new "no data yet" spots don't reinvent it a fourth way. */
export default function EmptyState({ title, sub, style }: { title: string; sub?: string; style?: React.CSSProperties }) {
  return (
    <div className="empty-state" style={style}>
      <div className="empty-state-title">{title}</div>
      {sub && <div className="empty-state-sub">{sub}</div>}
    </div>
  );
}
