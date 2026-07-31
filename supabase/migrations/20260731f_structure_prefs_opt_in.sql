-- Market-structure alert preferences: opt-out rows -> opt-in rows.
--
-- Before: `structure_1h` / `structure_4h` present = MUTED, absent = delivering.
-- After:  `structure_on_1h` / `structure_on_4h` present = DELIVERING, absent = silent.
--
-- Why (full reasoning in lib/structurePrefs.ts): the opt-out model cannot tell
-- "never configured" apart from "deliberately turned both on", because turning
-- a key on DELETES its row. That ambiguity is what let a brand-new alert type
-- ship OFF in the UI and ON in the cron - the default lived in the /alerts page
-- bootstrap, and the cron does not wait for anyone to open a page.
--
-- Translation, per user, for each of the two timeframes:
--   legacy mute row present  -> user had it OFF   -> write nothing
--   legacy mute row absent   -> user had it ON    -> insert structure_on_<tf>
-- ...but only for users who were configured under the old model at all (they
-- hold at least one legacy row). A user with no structure rows whatsoever was
-- never configured and stays silent, which is the whole point.
--
-- KNOWN, ACCEPTED EDGE: a user who had explicitly enabled BOTH timeframes also
-- holds zero rows, so they are indistinguishable from never-configured and end
-- up silent - they must re-enable on /alerts. At the time of writing prod has
-- exactly one Telegram recipient, holding `structure_4h` only (4H off, 1H on),
-- so nobody is actually in that bucket. Verified before running:
--   select key, count(*) from lhq_muted_alerts
--    where key in ('structure_1h','structure_4h') group by key;
--
-- Idempotent: the insert is guarded by NOT EXISTS on the target key, and the
-- delete is a no-op once the legacy rows are gone.
--
-- ORDERING - the two phases are NOT interchangeable, run phase 1 first.
--
--   Phase 1 (insert) is safe against BOTH code versions. Old code has never
--   heard of `structure_on_*`, so the new rows are inert until the deploy
--   lands; new code reads them as the enable.
--
--   Phase 2 (delete) is safe only AFTER the new code is live. Under old code a
--   missing `structure_4h` row means UNMUTED - dropping it early would start
--   sending exactly the 4H alerts the row exists to suppress. Phase 1 does not
--   protect against this: old code ignores `structure_on_4h` entirely, so the
--   legacy mute is the only thing holding 4H shut until the deploy.
--
-- Leaving phase 2 unrun indefinitely is harmless. Under new code a legacy
-- `structure_<tf>` row still blocks through entryMuteKeys, so it agrees with
-- the absent `structure_on_<tf>`; it is only redundant, not wrong.

-- ── PHASE 1 - PROD (qdpwhnvmhqgzijuwopso). Run any time. ─────────────────────
insert into lhq_muted_alerts (user_id, key)
select u.user_id, 'structure_on_' || tf.tf
from (
  select distinct user_id from lhq_muted_alerts
  where key in ('structure_1h', 'structure_4h')
) u
cross join (values ('1h'), ('4h')) as tf(tf)
where not exists (
  select 1 from lhq_muted_alerts m
  where m.user_id = u.user_id and m.key = 'structure_' || tf.tf
)
and not exists (
  select 1 from lhq_muted_alerts m
  where m.user_id = u.user_id and m.key = 'structure_on_' || tf.tf
);

-- ── PHASE 2 - PROD. Run ONLY after the new code is live on prod. ────────────
-- delete from lhq_muted_alerts where key in ('structure_1h', 'structure_4h');

-- ── DEV (wdtjhrilakoitfcezxpx) - both phases, dev already runs the new code ──
-- insert into lhq_dev_muted_alerts (user_id, key)
-- select u.user_id, 'structure_on_' || tf.tf
-- from (
--   select distinct user_id from lhq_dev_muted_alerts
--   where key in ('structure_1h', 'structure_4h')
-- ) u
-- cross join (values ('1h'), ('4h')) as tf(tf)
-- where not exists (
--   select 1 from lhq_dev_muted_alerts m
--   where m.user_id = u.user_id and m.key = 'structure_' || tf.tf
-- )
-- and not exists (
--   select 1 from lhq_dev_muted_alerts m
--   where m.user_id = u.user_id and m.key = 'structure_on_' || tf.tf
-- );
--
-- delete from lhq_dev_muted_alerts where key in ('structure_1h', 'structure_4h');
