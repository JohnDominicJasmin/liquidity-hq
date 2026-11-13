-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release, after QA's width check covers the new
-- strings in all locales; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Arena's coin scanner no longer prints a bare dash for a missing quote (#1263, owner, 2026-11-13). The English wording ships in `lib/labelDefaults.en.json`; the rows below carry the
-- other four locales, and ONE English row, because a database row silently WINS over the shipped default (lib/labelOverrides.ts):
--
--   ARENA_SCANNER_NO_SIGNALS               EXISTING key. Its default changes from "n/a" to "No signals", so production's existing rows (all five locales) must be rewritten or the old text stays.
--   ARENA_SCANNER_LOADING_TITLE            "Loading"                                        (hover/assistive name of the loading ellipsis)
--   ARENA_SCANNER_UNAVAILABLE              "Unavailable"                                    (price cell: this instrument has no quote right now)
--   ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE "The exchange did not answer. Retrying."
--   ARENA_SCANNER_UNAVAILABLE_NONE_TITLE   "No price for this instrument from our sources."
--   ARENA_SCANNER_UNAVAILABLE_NARROW       "No data"                                         (the price cell at 480 px and below, in plain words that wrap; never an abbreviation)
--
-- THE NON-ENGLISH ROWS ARE MACHINE-DRAFTED AND NOT NATIVE-REVIEWED, AND THAT IS THE OWNER'S DECISION FOR THIS RELEASE: on 2026-11-13 the owner ruled first-hand, via PM, to ship AI-drafted
-- translations for the picker labels (20261113b) and for the same-release scanner labels, the same choice as the tour text (20261113a). Each was re-read against the English; none names a vendor or model.
-- Treat them as drafts until a native reader has been through them. Upserts by (key, locale): re-running is safe, and no row for any other key is touched.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ARENA_SCANNER_NO_SIGNALS','en','No signals'),
('ARENA_SCANNER_NO_SIGNALS','ko','신호 없음'),
('ARENA_SCANNER_NO_SIGNALS','zh','无信号'),
('ARENA_SCANNER_NO_SIGNALS','ru','Нет сигналов'),
('ARENA_SCANNER_NO_SIGNALS','ar','لا إشارات'),
('ARENA_SCANNER_LOADING_TITLE','ko','불러오는 중'),
('ARENA_SCANNER_LOADING_TITLE','zh','加载中'),
('ARENA_SCANNER_LOADING_TITLE','ru','Загрузка'),
('ARENA_SCANNER_LOADING_TITLE','ar','جارٍ التحميل'),
('ARENA_SCANNER_UNAVAILABLE','ko','이용 불가'),
('ARENA_SCANNER_UNAVAILABLE','zh','不可用'),
('ARENA_SCANNER_UNAVAILABLE','ru','Недоступно'),
('ARENA_SCANNER_UNAVAILABLE','ar','غير متاح'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','ko','거래소가 응답하지 않았습니다. 다시 시도하는 중입니다.'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','zh','交易所未响应，正在重试。'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','ru','Биржа не ответила. Повторяем попытку.'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','ar','لم تستجب البورصة. نعيد المحاولة.'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','ko','저희 데이터 소스에는 이 상품의 가격이 없습니다.'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','zh','我们的数据源没有该品种的价格。'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','ru','В наших источниках нет цены для этого инструмента.'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','ar','لا يتوفر سعر لهذه الأداة من مصادرنا.'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','ko','데이터 없음'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','zh','无数据'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','ru','Нет данных'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','ar','لا بيانات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ARENA_SCANNER_NO_SIGNALS','en','No signals'),
('ARENA_SCANNER_NO_SIGNALS','ko','신호 없음'),
('ARENA_SCANNER_NO_SIGNALS','zh','无信号'),
('ARENA_SCANNER_NO_SIGNALS','ru','Нет сигналов'),
('ARENA_SCANNER_NO_SIGNALS','ar','لا إشارات'),
('ARENA_SCANNER_LOADING_TITLE','ko','불러오는 중'),
('ARENA_SCANNER_LOADING_TITLE','zh','加载中'),
('ARENA_SCANNER_LOADING_TITLE','ru','Загрузка'),
('ARENA_SCANNER_LOADING_TITLE','ar','جارٍ التحميل'),
('ARENA_SCANNER_UNAVAILABLE','ko','이용 불가'),
('ARENA_SCANNER_UNAVAILABLE','zh','不可用'),
('ARENA_SCANNER_UNAVAILABLE','ru','Недоступно'),
('ARENA_SCANNER_UNAVAILABLE','ar','غير متاح'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','ko','거래소가 응답하지 않았습니다. 다시 시도하는 중입니다.'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','zh','交易所未响应，正在重试。'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','ru','Биржа не ответила. Повторяем попытку.'),
('ARENA_SCANNER_UNAVAILABLE_FAILED_TITLE','ar','لم تستجب البورصة. نعيد المحاولة.'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','ko','저희 데이터 소스에는 이 상품의 가격이 없습니다.'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','zh','我们的数据源没有该品种的价格。'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','ru','В наших источниках нет цены для этого инструмента.'),
('ARENA_SCANNER_UNAVAILABLE_NONE_TITLE','ar','لا يتوفر سعر لهذه الأداة من مصادرنا.'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','ko','데이터 없음'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','zh','无数据'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','ru','Нет данных'),
('ARENA_SCANNER_UNAVAILABLE_NARROW','ar','لا بيانات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
