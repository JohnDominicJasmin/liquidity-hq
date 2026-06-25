-- Add trading profile columns to user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS trading_experience text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trading_style      text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS how_heard          text DEFAULT NULL;

-- Add profile_complete flag to user_onboarding
ALTER TABLE public.user_onboarding
  ADD COLUMN IF NOT EXISTS profile_complete boolean DEFAULT false;

-- Existing users who already saw the tour skip the onboarding flow
UPDATE public.user_onboarding
  SET profile_complete = true
  WHERE tour_seen = true;
