'use client';
import NewsFeed from '@/components/NewsFeed';
import NewsBanner from '@/components/NewsBanner';

export default function NewsPage() {
  return (
    <div>
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>News</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>Live alerts + econ calendar · NY session 8PM–7AM PHT</div>
      </div>
      <NewsBanner />
      <NewsFeed />
    </div>
  );
}
