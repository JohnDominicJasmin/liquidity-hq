-- ── user_subscriptions ───────────────────────────────────────────────────────
-- Tracks LemonSqueezy subscription state per user.
-- Written only by the webhook (service role). Users can read their own row.
-- Run in: Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  user_id             uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role                text        NOT NULL DEFAULT 'free',  -- 'free' | 'pro'
  ls_subscription_id  text,
  ls_customer_id      text,
  ls_status           text,       -- 'active' | 'cancelled' | 'expired' | 'past_due'
  current_period_end  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription row
CREATE POLICY "sub_select_own" ON public.user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role (webhook) can insert/update - no user-facing write policy
