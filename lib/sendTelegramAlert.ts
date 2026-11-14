import { getAuthToken } from '@/lib/supabase';

/* DASHBOARD-TRIGGERED TELEGRAM ALERTS, SENT AS THE SIGNED-IN USER (security audit #1413, S5).
 * /api/telegram/send used to accept anyone and post to ONE global chat (the owner's), so any visitor's browser could fill it. It now needs a signed-in Pro session and sends to
 * that user's OWN linked chat. A signed-out visitor sends nothing: there is no token, so this returns without a request. Fire and forget: an alert must never block the UI. */
export async function sendTelegramAlert(message: string): Promise<void> {
  try {
    const token = await getAuthToken();
    if (!token) return;
    await fetch('/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    });
  } catch { /* silent: an alert failure must not block the UI */ }
}
