-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The correlation panel states the average correlation instead of an alt-season call and an instruction; the yen descriptions state the level as a fact; the Pine export carries an
-- unverified note (new key BACKTEST_PINE_UNVERIFIED_NOTE). The en rows REPLACE any stored old wording (stored rows win over the shipped defaults); ko/zh/ru/ar REPLACE the stored
-- old-wording translations. AI-drafted, not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','en','Low correlation'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','en','BTC-alt average correlation is {avg}: altcoins have been moving mostly independently of BTC.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','en','Moderate correlation'),
('CORRELATION_ALT_SIG_MIXED_DESC','en','BTC-alt average correlation is {avg}: some alts have followed BTC and others have not.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','en','High correlation'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','en','BTC-alt average correlation is {avg}: most alts have moved with BTC.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','en','Very high correlation'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','en','BTC-alt average correlation is {avg}: alts have moved almost in step with BTC.'),
('BRIEFING_YEN_DANGER_DESC','en','USD/JPY is at or above 160. If the yen rises quickly from here, yen carry trades can be unwound, and that has coincided with crypto selloffs before.'),
('BRIEFING_YEN_WARNING_DESC','en','USD/JPY is between 158 and 160.'),
('BRIEFING_YEN_SAFE_DESC','en','USD/JPY is below 158.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','en','Unverified AI-generated script. Compile it and test it before you use it.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','ko','낮은 상관관계'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 알트코인이 대체로 BTC와 독립적으로 움직였습니다.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','ko','중간 상관관계'),
('CORRELATION_ALT_SIG_MIXED_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 일부 알트는 BTC를 따랐고 일부는 그렇지 않았습니다.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','ko','높은 상관관계'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 대부분의 알트가 BTC와 함께 움직였습니다.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','ko','매우 높은 상관관계'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 알트가 BTC와 거의 같은 방향으로 움직였습니다.'),
('BRIEFING_YEN_DANGER_DESC','ko','USD/JPY가 160 이상입니다. 여기서 엔화가 빠르게 강세를 보이면 엔 캐리 트레이드가 청산될 수 있으며, 이는 과거 암호화폐 하락과 겹친 적이 있습니다.'),
('BRIEFING_YEN_WARNING_DESC','ko','USD/JPY가 158과 160 사이입니다.'),
('BRIEFING_YEN_SAFE_DESC','ko','USD/JPY가 158 미만입니다.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','ko','검증되지 않은 AI 생성 스크립트입니다. 사용하기 전에 컴파일하고 테스트하세요.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','zh','相关性低'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:山寨币大体独立于 BTC 波动。'),
('CORRELATION_ALT_SIG_MIXED_LABEL','zh','相关性中等'),
('CORRELATION_ALT_SIG_MIXED_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:部分山寨币跟随 BTC,部分没有。'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','zh','相关性高'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:大多数山寨币随 BTC 波动。'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','zh','相关性很高'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:山寨币几乎与 BTC 同步波动。'),
('BRIEFING_YEN_DANGER_DESC','zh','USD/JPY 处于 160 或以上。若日元从此水平快速走强,日元套利交易可能被平仓,这在过去曾与加密货币下跌同时出现。'),
('BRIEFING_YEN_WARNING_DESC','zh','USD/JPY 在 158 至 160 之间。'),
('BRIEFING_YEN_SAFE_DESC','zh','USD/JPY 低于 158。'),
('BACKTEST_PINE_UNVERIFIED_NOTE','zh','未经验证的 AI 生成脚本。使用前请先编译并测试。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','ru','Низкая корреляция'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Альткоины в основном двигались независимо от BTC.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','ru','Умеренная корреляция'),
('CORRELATION_ALT_SIG_MIXED_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Одни альткоины следовали за BTC, другие нет.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','ru','Высокая корреляция'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Большинство альткоинов двигались вместе с BTC.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','ru','Очень высокая корреляция'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Альткоины двигались почти синхронно с BTC.'),
('BRIEFING_YEN_DANGER_DESC','ru','USD/JPY на уровне 160 или выше. Если иена быстро вырастет отсюда, керри-трейды по иене могут закрываться, и раньше это совпадало с падениями крипторынка.'),
('BRIEFING_YEN_WARNING_DESC','ru','USD/JPY между 158 и 160.'),
('BRIEFING_YEN_SAFE_DESC','ru','USD/JPY ниже 158.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','ru','Непроверенный скрипт, созданный ИИ. Скомпилируйте и протестируйте его перед использованием.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','ar','ارتباط منخفض'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تحركت العملات البديلة في الغالب باستقلال عن BTC.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','ar','ارتباط متوسط'),
('CORRELATION_ALT_SIG_MIXED_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تبعت بعض العملات البديلة BTC ولم تتبعه أخرى.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','ar','ارتباط مرتفع'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تحركت معظم العملات البديلة مع BTC.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','ar','ارتباط مرتفع جداً'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تحركت العملات البديلة تقريباً بالتزامن مع BTC.'),
('BRIEFING_YEN_DANGER_DESC','ar','USD/JPY عند 160 أو أعلى. إذا ارتفع الين بسرعة من هنا فقد تُفك صفقات الفائدة بالين، وقد تزامن ذلك سابقاً مع هبوط العملات المشفرة.'),
('BRIEFING_YEN_WARNING_DESC','ar','USD/JPY بين 158 و160.'),
('BRIEFING_YEN_SAFE_DESC','ar','USD/JPY أقل من 158.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','ar','نص برمجي مولَّد بالذكاء الاصطناعي وغير موثّق. قم بتجميعه واختباره قبل استخدامه.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','en','Low correlation'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','en','BTC-alt average correlation is {avg}: altcoins have been moving mostly independently of BTC.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','en','Moderate correlation'),
('CORRELATION_ALT_SIG_MIXED_DESC','en','BTC-alt average correlation is {avg}: some alts have followed BTC and others have not.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','en','High correlation'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','en','BTC-alt average correlation is {avg}: most alts have moved with BTC.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','en','Very high correlation'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','en','BTC-alt average correlation is {avg}: alts have moved almost in step with BTC.'),
('BRIEFING_YEN_DANGER_DESC','en','USD/JPY is at or above 160. If the yen rises quickly from here, yen carry trades can be unwound, and that has coincided with crypto selloffs before.'),
('BRIEFING_YEN_WARNING_DESC','en','USD/JPY is between 158 and 160.'),
('BRIEFING_YEN_SAFE_DESC','en','USD/JPY is below 158.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','en','Unverified AI-generated script. Compile it and test it before you use it.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_dev_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','ko','낮은 상관관계'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 알트코인이 대체로 BTC와 독립적으로 움직였습니다.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','ko','중간 상관관계'),
('CORRELATION_ALT_SIG_MIXED_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 일부 알트는 BTC를 따랐고 일부는 그렇지 않았습니다.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','ko','높은 상관관계'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 대부분의 알트가 BTC와 함께 움직였습니다.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','ko','매우 높은 상관관계'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','ko','BTC-알트 평균 상관관계는 {avg}입니다: 알트가 BTC와 거의 같은 방향으로 움직였습니다.'),
('BRIEFING_YEN_DANGER_DESC','ko','USD/JPY가 160 이상입니다. 여기서 엔화가 빠르게 강세를 보이면 엔 캐리 트레이드가 청산될 수 있으며, 이는 과거 암호화폐 하락과 겹친 적이 있습니다.'),
('BRIEFING_YEN_WARNING_DESC','ko','USD/JPY가 158과 160 사이입니다.'),
('BRIEFING_YEN_SAFE_DESC','ko','USD/JPY가 158 미만입니다.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','ko','검증되지 않은 AI 생성 스크립트입니다. 사용하기 전에 컴파일하고 테스트하세요.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_dev_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','zh','相关性低'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:山寨币大体独立于 BTC 波动。'),
('CORRELATION_ALT_SIG_MIXED_LABEL','zh','相关性中等'),
('CORRELATION_ALT_SIG_MIXED_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:部分山寨币跟随 BTC,部分没有。'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','zh','相关性高'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:大多数山寨币随 BTC 波动。'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','zh','相关性很高'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','zh','BTC 与山寨币的平均相关性为 {avg}:山寨币几乎与 BTC 同步波动。'),
('BRIEFING_YEN_DANGER_DESC','zh','USD/JPY 处于 160 或以上。若日元从此水平快速走强,日元套利交易可能被平仓,这在过去曾与加密货币下跌同时出现。'),
('BRIEFING_YEN_WARNING_DESC','zh','USD/JPY 在 158 至 160 之间。'),
('BRIEFING_YEN_SAFE_DESC','zh','USD/JPY 低于 158。'),
('BACKTEST_PINE_UNVERIFIED_NOTE','zh','未经验证的 AI 生成脚本。使用前请先编译并测试。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_dev_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','ru','Низкая корреляция'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Альткоины в основном двигались независимо от BTC.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','ru','Умеренная корреляция'),
('CORRELATION_ALT_SIG_MIXED_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Одни альткоины следовали за BTC, другие нет.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','ru','Высокая корреляция'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Большинство альткоинов двигались вместе с BTC.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','ru','Очень высокая корреляция'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','ru','Средняя корреляция BTC и альткоинов: {avg}. Альткоины двигались почти синхронно с BTC.'),
('BRIEFING_YEN_DANGER_DESC','ru','USD/JPY на уровне 160 или выше. Если иена быстро вырастет отсюда, керри-трейды по иене могут закрываться, и раньше это совпадало с падениями крипторынка.'),
('BRIEFING_YEN_WARNING_DESC','ru','USD/JPY между 158 и 160.'),
('BRIEFING_YEN_SAFE_DESC','ru','USD/JPY ниже 158.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','ru','Непроверенный скрипт, созданный ИИ. Скомпилируйте и протестируйте его перед использованием.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

insert into lhq_dev_labels (key, locale, value) values
('CORRELATION_ALT_SIG_ALT_SEASON_LABEL','ar','ارتباط منخفض'),
('CORRELATION_ALT_SIG_ALT_SEASON_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تحركت العملات البديلة في الغالب باستقلال عن BTC.'),
('CORRELATION_ALT_SIG_MIXED_LABEL','ar','ارتباط متوسط'),
('CORRELATION_ALT_SIG_MIXED_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تبعت بعض العملات البديلة BTC ولم تتبعه أخرى.'),
('CORRELATION_ALT_SIG_BTC_LEADING_LABEL','ar','ارتباط مرتفع'),
('CORRELATION_ALT_SIG_BTC_LEADING_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تحركت معظم العملات البديلة مع BTC.'),
('CORRELATION_ALT_SIG_LOCKSTEP_LABEL','ar','ارتباط مرتفع جداً'),
('CORRELATION_ALT_SIG_LOCKSTEP_DESC','ar','متوسط الارتباط بين BTC والعملات البديلة هو {avg}: تحركت العملات البديلة تقريباً بالتزامن مع BTC.'),
('BRIEFING_YEN_DANGER_DESC','ar','USD/JPY عند 160 أو أعلى. إذا ارتفع الين بسرعة من هنا فقد تُفك صفقات الفائدة بالين، وقد تزامن ذلك سابقاً مع هبوط العملات المشفرة.'),
('BRIEFING_YEN_WARNING_DESC','ar','USD/JPY بين 158 و160.'),
('BRIEFING_YEN_SAFE_DESC','ar','USD/JPY أقل من 158.'),
('BACKTEST_PINE_UNVERIFIED_NOTE','ar','نص برمجي مولَّد بالذكاء الاصطناعي وغير موثّق. قم بتجميعه واختباره قبل استخدامه.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
