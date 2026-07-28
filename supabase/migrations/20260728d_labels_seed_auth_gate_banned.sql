-- AuthGate's live-ban-kill notice text.
-- Run once against BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('AUTH_GATE_BANNED_DESC','en','Your account has been suspended. Contact support if you believe this is a mistake.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
