-- Add trading profile columns (prod + dev)
ALTER TABLE public.lhq_user_settings
  ADD COLUMN IF NOT EXISTS trading_experience text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trading_style      text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS how_heard          text DEFAULT NULL;

ALTER TABLE public.lhq_dev_user_settings
  ADD COLUMN IF NOT EXISTS trading_experience text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trading_style      text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS how_heard          text DEFAULT NULL;

-- Add profile_complete flag (prod + dev)
ALTER TABLE public.lhq_user_onboarding
  ADD COLUMN IF NOT EXISTS profile_complete boolean DEFAULT false;

ALTER TABLE public.lhq_dev_user_onboarding
  ADD COLUMN IF NOT EXISTS profile_complete boolean DEFAULT false;

-- Existing users who already saw the tour skip the new onboarding flow
UPDATE public.lhq_user_onboarding
  SET profile_complete = true
  WHERE tour_seen = true;

UPDATE public.lhq_dev_user_onboarding
  SET profile_complete = true
  WHERE tour_seen = true;
