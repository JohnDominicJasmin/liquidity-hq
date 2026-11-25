-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- Korean labels that showed English (#1640). Not included: PRIVACY_SECTION_INTERNATIONAL_USERS_BODY (legal text, see 20261031b).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ARENA_LIVE_BADGE','ko','LiquidityAI · 실시간 · 웹 + X'),
('ARENA_PAGE_SUBTITLE','ko','원하는 코인에 AI 분석을 실행하세요 - 방향, 신뢰도, 그 근거가 된 신호를 보여 줍니다.'),
('BTC_RISK_LEVEL_BAR_LOW','ko','낮음'),
('DASH_PULSE_VOL_LABEL','ko','거래량'),
('GLOBAL_MACRO_CONTEXT_PREPARING','ko','AI 분석을 준비하는 중…'),
('LEARN_CONTENT_RESULTS_COUNT','ko','용어 {total}개 중 {count}개'),
('LIQ_HEATMAP_ESTIMATED_TAG','ko','추정치'),
('SETUP_SCANNER_TAKER_NONE','ko','테이커 -'),
('SETUP_SCANNER_TAKER_VAL','ko','테이커 {pct}%'),
('WHALE_TRADES_FEED_BADGE_MEGA','ko','초대형'),
('WHALE_TRADES_FEED_BADGE_WHALE','ko','고래')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ARENA_LIVE_BADGE','ko','LiquidityAI · 실시간 · 웹 + X'),
('ARENA_PAGE_SUBTITLE','ko','원하는 코인에 AI 분석을 실행하세요 - 방향, 신뢰도, 그 근거가 된 신호를 보여 줍니다.'),
('BTC_RISK_LEVEL_BAR_LOW','ko','낮음'),
('DASH_PULSE_VOL_LABEL','ko','거래량'),
('GLOBAL_MACRO_CONTEXT_PREPARING','ko','AI 분석을 준비하는 중…'),
('LEARN_CONTENT_RESULTS_COUNT','ko','용어 {total}개 중 {count}개'),
('LIQ_HEATMAP_ESTIMATED_TAG','ko','추정치'),
('SETUP_SCANNER_TAKER_NONE','ko','테이커 -'),
('SETUP_SCANNER_TAKER_VAL','ko','테이커 {pct}%'),
('WHALE_TRADES_FEED_BADGE_MEGA','ko','초대형'),
('WHALE_TRADES_FEED_BADGE_WHALE','ko','고래')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
