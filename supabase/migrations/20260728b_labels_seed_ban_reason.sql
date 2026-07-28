-- Ban-reason prompt/display copy for the /ops user detail page.
-- Run once against BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('OPS_USER_DETAIL_BAN_REASON_PROMPT','en','Reason for ban (shown to the user, optional):'),
('OPS_USER_DETAIL_BAN_REASON_LABEL','en','Reason: {reason}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
