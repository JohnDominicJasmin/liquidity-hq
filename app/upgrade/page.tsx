'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { getCheckoutUrl } from '@/lib/checkout';

export default function UpgradePage() {
  const { user, loading, isPro } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login?signup=1&next=/upgrade'); return; }
    if (isPro) { router.replace('/arena'); return; }
    const url = getCheckoutUrl(user);
    window.location.href = url;
  }, [user, loading, isPro, router]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888', fontSize: 14 }}>
      Redirecting to checkout…
    </div>
  );
}
