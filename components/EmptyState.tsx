/** Shared empty-state placeholder (item #25) - wraps the .empty-state CSS
    convention that TradeJournal/DistributionTracker/alerts already used
    ad-hoc, so new "no data yet" spots don't reinvent it a fourth way.
    `dashed` opts into the bounded dashed-card look (was each calculator's
    own one-off .ps-empty) instead of the plain borderless text block. */
export default function EmptyState({ title, sub, dashed, style }: { title: string; sub?: string; dashed?: boolean; style?: React.CSSProperties }) {
  return (
    <div className={dashed ? 'empty-state empty-state-dashed' : 'empty-state'} style={style}>
      <div className="empty-state-title">{title}</div>
      {sub && <div className="empty-state-sub">{sub}</div>}
    </div>
  );
}
