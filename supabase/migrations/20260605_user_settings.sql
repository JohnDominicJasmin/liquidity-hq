-- ── user_settings ────────────────────────────────────────────────────────────
-- One row per user; stores all configurable preferences.
-- Run this in: Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Trading profile
  account_size     numeric     NOT NULL DEFAULT 1000,
  risk_pct         numeric     NOT NULL DEFAULT 1.5,
  -- AI Arena defaults
  default_coin     text        NOT NULL DEFAULT 'btc',
  default_tf       text        NOT NULL DEFAULT '15m',
  -- Notification thresholds (client-side push alerts)
  fr_threshold     numeric     NOT NULL DEFAULT 0.05,
  fng_fear         int         NOT NULL DEFAULT 15,
  fng_greed        int         NOT NULL DEFAULT 85,
  rsi_ob           int         NOT NULL DEFAULT 70,
  rsi_os           int         NOT NULL DEFAULT 30,
  -- Appearance
  hidden_sections  text[]      NOT NULL DEFAULT '{}',
  -- Metadata
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- RLS: each user can only see and modify their own row
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings_select" ON public.user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_settings_insert" ON public.user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_settings_update" ON public.user_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
