// Build a LemonSqueezy checkout URL with the user's email + ID pre-filled
// so the webhook can match the payment back to the correct Supabase user.
export function getCheckoutUrl(user: { id: string; email?: string } | null): string {
  const base = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL;
  if (!base || base === '#') return '/login?signup=1';
  try {
    const url = new URL(base);
    if (user?.email) url.searchParams.set('checkout[email]', user.email);
    if (user?.id)    url.searchParams.set('checkout[custom][user_id]', user.id);
    return url.toString();
  } catch {
    return base;
  }
}
