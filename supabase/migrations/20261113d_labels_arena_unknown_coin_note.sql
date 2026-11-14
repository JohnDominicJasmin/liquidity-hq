-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- A new key for Arena (#1263): a deep link that names a coin Arena does not offer (/arena?coin=zzzz) used to open BTC silently and rewrite the address; it now says so.
--   ARENA_UNKNOWN_COIN_NOTE   en: We do not list "{coin}", so Arena opened BTC.      ({coin} is the upper-cased text from the link; it must survive translation unchanged)
-- The English wording ships in `lib/labelDefaults.en.json` and needs no row. The four non-English rows are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling to ship
-- AI-drafted translations for this release's Arena labels (20261113b, 20261113c); treat them as drafts until a native reader has been through them.
-- Upserts by (key, locale): re-running is safe, and no row for any other key is touched.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ARENA_UNKNOWN_COIN_NOTE','ko','"{coin}"은(는) 지원하지 않는 종목이라 Arena가 BTC를 열었습니다.'),
('ARENA_UNKNOWN_COIN_NOTE','zh','我们没有“{coin}”这个品种，所以 Arena 打开了 BTC。'),
('ARENA_UNKNOWN_COIN_NOTE','ru','Инструмента «{coin}» у нас нет, поэтому Arena открыла BTC.'),
('ARENA_UNKNOWN_COIN_NOTE','ar','لا نعرض الأداة «{coin}»، لذلك فتح Arena عملة BTC.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ARENA_UNKNOWN_COIN_NOTE','ko','"{coin}"은(는) 지원하지 않는 종목이라 Arena가 BTC를 열었습니다.'),
('ARENA_UNKNOWN_COIN_NOTE','zh','我们没有“{coin}”这个品种，所以 Arena 打开了 BTC。'),
('ARENA_UNKNOWN_COIN_NOTE','ru','Инструмента «{coin}» у нас нет, поэтому Arena открыла BTC.'),
('ARENA_UNKNOWN_COIN_NOTE','ar','لا نعرض الأداة «{coin}»، لذلك فتح Arena عملة BTC.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
