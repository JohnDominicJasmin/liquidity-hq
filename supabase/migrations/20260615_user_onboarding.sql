-- user_onboarding: tracks tour completion + 4-item setup checklist per user
CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_seen           boolean DEFAULT false,
  checklist_telegram  boolean DEFAULT false,
  checklist_price_alert boolean DEFAULT false,
  checklist_grok      boolean DEFAULT false,
  checklist_coins     boolean DEFAULT false,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own onboarding"
  ON user_onboarding
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
