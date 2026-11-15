-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- /hours copy that predicted or instructed with no measurement behind it (#1263 box, PM 2026-11-15): the five HOURS_WIN_*_DESC descriptions were rewritten in 20261108a (pending prod); this file covers the REST of the page:
--   HOURS_HINT_BODY ("cleanest moves"), HOURS_SESSION_MAP_TIP ("the best liquidity to trade into, and where most large moves start"), HOURS_DEAD_ZONE_MSG ("do not trade"), HOURS_GO_HUNT ("Go hunt."), HOURS_WIN_PRIME_DESC ("usually the most active part of the day").
-- Each new line describes the time window only (which session is open, what overlaps), nothing about what price will do. en rows are included because prod has en rows for these keys (the 20260723z seed) and a row wins over the shipped default. ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling.
-- Label rows only, no DDL. The DEV block is commented out per 20260912b's convention (__tests__/pageHintRollout.test.mts L2b reads the commented en rows for HOURS_HINT_BODY): uncomment it to apply on dev. Upserts by (key, locale), so a re-run is a no-op.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('HOURS_HINT_BODY','en','A live local clock and a 24-hour session map showing when the Asia, London and New York sessions are open and when they overlap.'),
('HOURS_HINT_BODY','ko','현지 시간 기준의 실시간 시계와, 아시아·런던·뉴욕 세션이 열리는 시간과 겹치는 시간을 보여주는 24시간 세션 맵입니다.'),
('HOURS_HINT_BODY','zh','实时本地时钟和 24 小时交易时段图，显示亚洲、伦敦和纽约交易时段何时开盘、何时重叠。'),
('HOURS_HINT_BODY','ru','Живые часы по местному времени и 24-часовая карта сессий: когда открыты азиатская, лондонская и нью-йоркская сессии и когда они пересекаются.'),
('HOURS_SESSION_MAP_TIP','en','Highlights the hours when major markets (Asia, London, New York) are open and overlapping.'),
('HOURS_SESSION_MAP_TIP','ko','주요 시장(아시아, 런던, 뉴욕)이 열려 있고 겹치는 시간대를 강조 표시합니다.'),
('HOURS_SESSION_MAP_TIP','zh','标出主要市场（亚洲、伦敦、纽约）开盘及重叠的时段。'),
('HOURS_SESSION_MAP_TIP','ru','Показывает часы, когда крупнейшие рынки (Азия, Лондон, Нью-Йорк) открыты и пересекаются.'),
('HOURS_DEAD_ZONE_MSG','en','Dead zone window'),
('HOURS_DEAD_ZONE_MSG','ko','데드존 시간대'),
('HOURS_DEAD_ZONE_MSG','zh','死亡时段'),
('HOURS_DEAD_ZONE_MSG','ru','Окно «мёртвой зоны»'),
('HOURS_GO_HUNT','en','This window is open now.'),
('HOURS_GO_HUNT','ko','이 시간대는 지금 열려 있습니다.'),
('HOURS_GO_HUNT','zh','此时段目前开放。'),
('HOURS_GO_HUNT','ru','Это окно сейчас открыто.'),
('HOURS_WIN_PRIME_DESC','en','The US afternoon session, up to the US stock market close.'),
('HOURS_WIN_PRIME_DESC','ko','미국 오후 세션으로, 미국 증시 마감까지의 시간대입니다.'),
('HOURS_WIN_PRIME_DESC','zh','美国下午交易时段，直到美股收盘。'),
('HOURS_WIN_PRIME_DESC','ru','Американская дневная сессия, до закрытия фондового рынка США.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx), COMMENTED OUT per 20260912b's convention (the rollout test reads it this way): uncomment to apply ============
-- insert into lhq_dev_labels (key, locale, value) values
-- ('HOURS_HINT_BODY','en','A live local clock and a 24-hour session map showing when the Asia, London and New York sessions are open and when they overlap.'),
-- ('HOURS_HINT_BODY','ko','현지 시간 기준의 실시간 시계와, 아시아·런던·뉴욕 세션이 열리는 시간과 겹치는 시간을 보여주는 24시간 세션 맵입니다.'),
-- ('HOURS_HINT_BODY','zh','实时本地时钟和 24 小时交易时段图，显示亚洲、伦敦和纽约交易时段何时开盘、何时重叠。'),
-- ('HOURS_HINT_BODY','ru','Живые часы по местному времени и 24-часовая карта сессий: когда открыты азиатская, лондонская и нью-йоркская сессии и когда они пересекаются.'),
-- ('HOURS_SESSION_MAP_TIP','en','Highlights the hours when major markets (Asia, London, New York) are open and overlapping.'),
-- ('HOURS_SESSION_MAP_TIP','ko','주요 시장(아시아, 런던, 뉴욕)이 열려 있고 겹치는 시간대를 강조 표시합니다.'),
-- ('HOURS_SESSION_MAP_TIP','zh','标出主要市场（亚洲、伦敦、纽约）开盘及重叠的时段。'),
-- ('HOURS_SESSION_MAP_TIP','ru','Показывает часы, когда крупнейшие рынки (Азия, Лондон, Нью-Йорк) открыты и пересекаются.'),
-- ('HOURS_DEAD_ZONE_MSG','en','Dead zone window'),
-- ('HOURS_DEAD_ZONE_MSG','ko','데드존 시간대'),
-- ('HOURS_DEAD_ZONE_MSG','zh','死亡时段'),
-- ('HOURS_DEAD_ZONE_MSG','ru','Окно «мёртвой зоны»'),
-- ('HOURS_GO_HUNT','en','This window is open now.'),
-- ('HOURS_GO_HUNT','ko','이 시간대는 지금 열려 있습니다.'),
-- ('HOURS_GO_HUNT','zh','此时段目前开放。'),
-- ('HOURS_GO_HUNT','ru','Это окно сейчас открыто.'),
-- ('HOURS_WIN_PRIME_DESC','en','The US afternoon session, up to the US stock market close.'),
-- ('HOURS_WIN_PRIME_DESC','ko','미국 오후 세션으로, 미국 증시 마감까지의 시간대입니다.'),
-- ('HOURS_WIN_PRIME_DESC','zh','美国下午交易时段，直到美股收盘。'),
-- ('HOURS_WIN_PRIME_DESC','ru','Американская дневная сессия, до закрытия фондового рынка США.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
