-- Add display_name, country, trading_challenge to user settings (prod + dev)
ALTER TABLE public.lhq_user_settings
  ADD COLUMN IF NOT EXISTS display_name      text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS country           text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trading_challenge text DEFAULT NULL;

ALTER TABLE public.lhq_dev_user_settings
  ADD COLUMN IF NOT EXISTS display_name      text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS country           text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trading_challenge text DEFAULT NULL;
