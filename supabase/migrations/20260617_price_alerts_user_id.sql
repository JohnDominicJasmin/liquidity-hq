-- Add user_id to price_alerts for per-user ownership and routing.
-- Nullable so existing rows (no user_id) stay valid — they fall back to
-- broadcasting to all connected Telegram users (legacy single-user behaviour).

ALTER TABLE public.price_alerts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS price_alerts_user_id_idx ON public.price_alerts(user_id);
