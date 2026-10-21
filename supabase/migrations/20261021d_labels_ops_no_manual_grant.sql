-- #1630 GO-LIVE 4 (payments audit): the ops user page no longer has "Grant Pro", and "Revoke Pro" is refused on a paid account. The note under the
-- action buttons said "Grant/Revoke Pro only touches the role", which is no longer what the page does. ONE key, five locales; the rows overwrite the live
-- ones (en/ar/ko/zh exist from 20260730a/20260731a/20260801a/20260802a; ru is new). ar/ko/ru/zh are Dev machine translations, NOT native-reviewed.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply to dev only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('OPS_USER_DETAIL_ACTIONS_NOTE','en','Pro is never granted by hand: it comes only from a payment. Revoke Pro appears only for a Pro with no payment behind it; a paid account keeps Pro until its paid time ends. Ban blocks sign-in via Supabase Auth; you cannot ban yourself. Every action is written to the audit log.'),
('OPS_USER_DETAIL_ACTIONS_NOTE','ar','لا يُمنح Pro يدويًا أبدًا: يأتي فقط من الدفع. يظهر "إلغاء Pro" فقط لحساب Pro لا يقف خلفه دفع؛ أما الحساب المدفوع فيحتفظ بـ Pro حتى ينتهي وقته المدفوع. يمنع الحظر تسجيل الدخول عبر Supabase Auth؛ ولا يمكنك حظر نفسك. يُسجَّل كل إجراء في سجل التدقيق.'),
('OPS_USER_DETAIL_ACTIONS_NOTE','ko','Pro는 수동으로 부여되지 않습니다. 결제를 통해서만 주어집니다. "Pro 해지"는 결제가 없는 Pro 계정에만 표시되며, 결제한 계정은 결제한 기간이 끝날 때까지 Pro를 유지합니다. 차단은 Supabase Auth를 통한 로그인을 막으며, 자기 자신은 차단할 수 없습니다. 모든 작업은 감사 로그에 기록됩니다.'),
('OPS_USER_DETAIL_ACTIONS_NOTE','ru','Pro никогда не выдаётся вручную: он появляется только после оплаты. «Отозвать Pro» показывается только для Pro без оплаты; оплаченный аккаунт сохраняет Pro до конца оплаченного периода. Блокировка запрещает вход через Supabase Auth; заблокировать себя нельзя. Каждое действие записывается в журнал аудита.'),
('OPS_USER_DETAIL_ACTIONS_NOTE','zh','Pro 从不手动授予：只能通过付款获得。“撤销 Pro”只对没有付款记录的 Pro 显示；已付款的账户会保留 Pro，直到已付费时间结束。封禁会阻止通过 Supabase Auth 登录；你不能封禁自己。每个操作都会写入审计日志。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('OPS_USER_DETAIL_ACTIONS_NOTE','en','Pro is never granted by hand: it comes only from a payment. Revoke Pro appears only for a Pro with no payment behind it; a paid account keeps Pro until its paid time ends. Ban blocks sign-in via Supabase Auth; you cannot ban yourself. Every action is written to the audit log.'),
-- ('OPS_USER_DETAIL_ACTIONS_NOTE','ar','لا يُمنح Pro يدويًا أبدًا: يأتي فقط من الدفع. يظهر "إلغاء Pro" فقط لحساب Pro لا يقف خلفه دفع؛ أما الحساب المدفوع فيحتفظ بـ Pro حتى ينتهي وقته المدفوع. يمنع الحظر تسجيل الدخول عبر Supabase Auth؛ ولا يمكنك حظر نفسك. يُسجَّل كل إجراء في سجل التدقيق.'),
-- ('OPS_USER_DETAIL_ACTIONS_NOTE','ko','Pro는 수동으로 부여되지 않습니다. 결제를 통해서만 주어집니다. "Pro 해지"는 결제가 없는 Pro 계정에만 표시되며, 결제한 계정은 결제한 기간이 끝날 때까지 Pro를 유지합니다. 차단은 Supabase Auth를 통한 로그인을 막으며, 자기 자신은 차단할 수 없습니다. 모든 작업은 감사 로그에 기록됩니다.'),
-- ('OPS_USER_DETAIL_ACTIONS_NOTE','ru','Pro никогда не выдаётся вручную: он появляется только после оплаты. «Отозвать Pro» показывается только для Pro без оплаты; оплаченный аккаунт сохраняет Pro до конца оплаченного периода. Блокировка запрещает вход через Supabase Auth; заблокировать себя нельзя. Каждое действие записывается в журнал аудита.'),
-- ('OPS_USER_DETAIL_ACTIONS_NOTE','zh','Pro 从不手动授予：只能通过付款获得。“撤销 Pro”只对没有付款记录的 Pro 显示；已付款的账户会保留 Pro，直到已付费时间结束。封禁会阻止通过 Supabase Auth 登录；你不能封禁自己。每个操作都会写入审计日志。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
