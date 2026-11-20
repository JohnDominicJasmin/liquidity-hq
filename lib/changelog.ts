// Public release notes for /changelog (#1810 item 1).
//
// ENGLISH DATA, NOT LABEL KEYS - the same choice lib/glossary.ts already makes
// for /learn. Two reasons, and the second is the one that decided it:
//
//   1. ~22 releases x 2-4 lines is ~60 new keys in lib/labelKeys.ts, which is a
//      LANDING HARD GATE file. Page chrome goes through t() like every other
//      page; the entries themselves do not.
//   2. A new key renders English in every locale anyway until somebody seeds a
//      translation row, because LabelsProvider merges the fetched map OVER
//      lib/labelDefaults.en.json. So t() would buy nothing today and cost a
//      translation bill on every future release.
//
// SOURCE: `git tag --sort=-creatordate --format='%(creatordate:short) %(refname:short) %(subject)'`.
// The tag is kept here as provenance and is deliberately NOT rendered.
//
// THREE EDITORIAL RULES, because the tag text will fight you on all of them:
//
//   1. Tag subjects are written for US - issue numbers, Render deploy ids,
//      /api/version hashes, branch names. Those are stripped. Rewriting the
//      rest in plain language is summarising, not inventing.
//   2. Work that is not user-visible, or that shipped deliberately switched
//      off, is DROPPED rather than described. Several tags say so outright
//      ("payments still OFF", "shipped dormant", "dark on production while
//      payments are off", "Backtest hidden"). Listing a dormant or hidden
//      feature breaks the owner's standing rule that copy says only what the
//      product does today, and "Backtest is hidden" names a missing feature
//      outright.
//   3. A release with nothing user-visible left after (1) and (2) does not get
//      an entry. v2026.10.23, v2026.09.11 and v2026.09.07 carry no description
//      at all; they are absent rather than invented. Per PM, bare tags are NOT
//      backfilled.
//
// TWO CALLS v2026.10.30 FORCED, recorded because rule 2 fights both ways on them:
//
//   #1804 EARNS AN ENTRY. A `lang` attribute is not something a user looks at, so rule 2
//   could read as dropping it. It is kept because of what it DOES: a screen reader uses it to
//   choose pronunciation and a browser uses it to offer a translation, so for a Korean or
//   Chinese reader it is the difference between a page that reads correctly and one that does
//   not. The item is written as that effect rather than as the attribute. The 26 October entry
//   already describes language-tag work in those terms, so this is the file's own precedent.
//
//   THE 404 APPEARANCE CHANGE IS NOT LISTED, and it is live on production. Two reasons: the
//   entry at 2026-10-18 already records that an unknown address answers with a proper 404
//   page, and the APPEARANCE change on top of it is unapproved by the owner with the undo
//   ready. Announcing a visual the owner may reverse is worse than announcing nothing.
//
//   ^ THAT CALL EXPIRED ON 2026-11-01 AND THE 2026-11-05 ENTRY LISTS IT. The condition was
//   "unapproved with the undo ready", and the owner then settled both halves himself: he
//   rejected the wording ("It should be page not found not liquidity not found") and asked for
//   the chart bigger after seeing it live. So the reason for holding it is gone, not overruled.
//   Left above rather than deleted, because the reasoning was right and a reader needs to know
//   which part changed - the approval, not the rule.
//
// DRAW STRUCTURE IS IN THE 2026-11-05 RELEASE AND IS DELIBERATELY ABSENT FROM ITS ENTRY,
// recorded here because rule 3's "absent rather than invented" cuts the other way too: a
// forgotten item and a withheld one look identical on the page.
//
//   STALE AS OF 2026-11-10 - CORRECTED BELOW RATHER THAN DELETED, because it is the premise the
//   whole hold rests on and a reader needs to see which part moved. It said:
//
//     "It ships SWITCHED OFF. `supabase/migrations/20261031a_draw_structure_usage.sql` is
//      unapplied, so the route answers 503 NOT_ENABLED on every environment, and its empty-state
//      message ("Nothing proposed on this window.") is unreachable with it."
//
//   THAT IS NO LONGER TRUE ON ANY ENVIRONMENT. Prod was applied by the owner on 2026-11-07 (see
//   the UPDATE below), and the DEV project - which serves dev, qa AND staging - was applied on
//   2026-11-08 via `20261108b_draw_structure_dev_function_half.sql` (#2082). Measured from both
//   databases after that apply: `increment_ai_usage_impl` carries 17 distinct `p_column` values,
//   each exactly twice, and dev and prod normalise to the same body hash
//   (0d71a2b421899b10091e653a6c7df47b). So "503 NOT_ENABLED on every environment" describes a
//   state that ended on 2026-11-08.
//
//   Rule 2 and the owner's "copy says only what the product does today" still govern - they are
//   just no longer satisfied by silence, which is why the line below is now a live question rather
//   than a settled one.
//
//   SO IT NEEDS TWO LINES, NOT ONE DECISION. If the owner enables it in this release, the entry
//   gains: 'On AI Arena, a 4-hour or daily chart can propose trend lines, channels and other
//   structures for you to keep or discard.' - and nothing about the empty state, which is a
//   detail of using it rather than a feature. If it stays off, the entry stays as it is and the
//   feature is announced in the release that turns it on.
//
//   UPDATE 2026-11-07: THE MIGRATION IS APPLIED ON PROD - the owner ran it himself after the
//   permission layer refused both QA and PM/DevOps. `draw_structure_count` exists on
//   `lhq_grok_usage` (23 columns, exactly one added), and the other gates check out free: the route
//   has no feature flag, GROK_API_KEY provably works (50 of 77 usage rows carry real calls), and
//   one entitled account exists.
//
//   THE LINE IS STILL OUT, because PM/DevOps's condition was "confirmed live on prod, with no
//   NOT_ENABLED from a real request" and `draw_structure_count` is still 0 - nobody has called it,
//   deliberately, since it is a metered xAI path that spends the owner's money. Applied is not
//   confirmed, and that distinction is the whole reason the line was held in the first place.
//
//   IT IS NOW ONE ACTION AWAY AND THE PROOF IS SELF-RECORDING: one Quick call by the owner on his
//   own account takes that counter to 1, and the evidence lands in the database rather than in a
//   report anyone has to trust. The sentence below is ready for the release after that.
//
//   STILL HELD ON 2026-11-10, AND NOT FOR THE ORIGINAL REASON. PM/DevOps asked for the line to go
//   into this release on the grounds that Draw Structure "has been live on prod since the 11-07
//   release (column present, route enabled)". The column and the route are indeed live - that much
//   is measured above. But PM/DevOps's OWN condition, recorded eight lines up, was "confirmed live
//   on prod, with no NOT_ENABLED from a real request", and the evidence for that is
//   `draw_structure_count > 0`.
//
//   I COULD NOT MEASURE IT: the Supabase connector was down when this was written, so the counter
//   is unknown to me rather than zero. An unknown is not a confirmation, and announcing a paid
//   feature to every reader of /changelog on "applied, therefore working" is exactly the inference
//   this block was created to refuse. The sentence is drafted and ready; it needs one person to
//   read the counter.
//
//   MEASURED ON 2026-11-06, AND IT WAS STILL OFF THEN, which is why it stayed out of that entry.
//   Both databases, queried directly rather than inferred from the migrations folder:
//
//     prod (qdpwhnvmhqgzijuwopso)  draw_structure_count column: ABSENT   20261031a applied: NO
//     dev  (wdtjhrilakoitfcezxpx)  draw_structure_count column: ABSENT   20261031a applied: NO
//
//   `qa` and `staging` both point at the dev database, so that is all four environments. The
//   route's gate turns a `not_enabled` reason into `503 NOT_ENABLED` (route.ts:438-441), so a
//   Pro user clicking Draw Structure today gets a 503 and nothing else.
//
//   PM/DevOps asked for the line on the grounds that Draw Structure is "the one thing a Pro user
//   would want to hear about" in this release. That is true about the feature and is exactly why
//   it must wait: the entry would be the first thing a Pro user reads and the thing they would
//   immediately go and try. Announcing it is announcing a 503. Rule 2 and the owner's standing
//   rule both land the same way, and the pre-drafted sentence above is ready for whichever
//   release applies 20261031a.
//
//   The release tag's own summary agrees - 'What a user can see: #1804 only' - and the other
//   27 commits are tests, QA tooling, CI corrections and documentation with no runtime effect.
//
// WHERE THE LIST STARTS. 2026-09-05 is the first tag with a real description;
// everything before it is "Release <date>". FIRST_ENTRY_NOTE on the page says
// so, so a reader is not left wondering whether the product existed before it.
//
// KNOWN GAP, stated rather than hidden: nothing updates this file when a
// release ships. It is a file somebody has to remember to edit - the same shape
// as RELEASE_PR_PAUSED. Making the tag the source at build time would fix it
// and is not in this change.

export interface ChangelogEntry {
  /** ISO date of the tag, used as the heading and the React key. */
  date: string;
  /** The git tag this came from. Provenance for the next editor; never rendered. */
  tag: string;
  /** Plain-language, user-visible lines. Never empty - an entry with no items is omitted instead. */
  items: string[];
}

/** Newest first, which is the order the page renders. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    /* DRAFT, the release after v2026.11.22 (Dev 2026-11-20, PM). Tag and date are set when THIS release is tagged: the date must be the tagged commit's %cs (rule 22; 2026-11-21 is a placeholder). Plain words, 12 words or fewer per line; only user-visible changes, facts only (QA checks each line).
       Tied to: #2712 (VWAP card decimals), #2715 (partial-day VWAP line), #2718 (liquidation prices per-token, sub-penny buckets), #2719 (left-edge labels, VWAP window), #2721 (AI Confirms-to line cap). A line whose PR misses the tag is removed. */
    date: '2026-11-21',
    tag: 'v2026.11.23',
    items: [
      "Liquidation levels now show for PEPE, BONK and other low-priced coins.",
      "Liquidation prices use one unit across both exchanges.",
      "VWAP reclaim draws the day's VWAP from the first candle.",
      "Strategy lines left of the visible candles show an edge label.",
      "VWAP reclaim on stocks reads further back when the market is closed.",
      "1000x coins show the Arena VWAP with fewer decimals.",
      "The AI read keeps its 'Confirms to' line short.",
    ],
  },
  {
    /* DRAFT, the release after v2026.11.21 (Dev 2026-11-20, PM). Tag and date are set when THIS release is tagged: the date must be the tagged commit's %cs (rule 22; 2026-11-20 is the date of the release merge, which PM checks at the tag). Plain words, 12 words or fewer per line;
       only user-visible changes. Tied to: #2680 + #2681 + #2683 (no failing text), the strategy drawings (#2676-#2678, #2685-#2687, #2700, #2705), #2706 + #2708 + #2711 + #2712 (one price unit), #2704 (SMA), #2709 + #2710 (Setup card). */
    date: '2026-11-20',
    tag: 'v2026.11.22',
    items: [
      "Every strategy now draws on the chart, even with no setup.",
      "Strategy lines off the visible price range show an edge label.",
      "Pages keep the last good value instead of 'unavailable' text.",
      "PEPE, BONK and other 1000x coins use one price unit.",
      "The SMA line is now a true simple moving average.",
      "Stock VWAP reclaim keeps the last session's line when the market closes.",
      "The Setup card no longer covers the Arena's strategy panel.",
    ],
  },
  {
    /* DRAFT, the release after v2026.11.20 (Dev 2026-11-19, PM). Tag and date are set when THIS release is tagged: the date must be the tagged commit's %cs (rule 22). Plain words, 12 words or fewer per line;
       only user-visible changes. Tied to: #2645 (correlation tint), #2647 (Free trader copy, lock badge, Trading Sessions), #2650 (one OI hour, Funding title, micro-cap prices), #2651 (offline notice), #2652 (small
       text), #2653 + #2655 + #2665 (facts, not advice), #2656 (news hero), #2649 (accessibility), #2662 (Russian banner), #2663 (EMA hover text), #2666 (zone label). */
    date: '2026-11-20',
    tag: 'v2026.11.21',
    items: [
      "Markets: very small coin prices keep their digits.",
      "A notice shows when your connection drops.",
      "Arena: Pro-only timeframes show a lock.",
      "Arena: Supply and Demand labels no longer cover the signal marker.",
      "The Best Hours page is now called Trading Sessions.",
      "Alerts, the risk card and Market Read state facts without advice.",
      "News: the first story is text only on desktop.",
      "Accessibility: clearer labels, keyboard focus and reduced-motion support.",
    ],
  },
  {
    /* DRAFT, the release after v2026.11.19 (PM 2026-11-19). Tag and date are set when THIS release is tagged: the date must be the tagged commit's %cs. Plain words, 12 words or fewer per line
       (rule 22); only user-visible changes. Tied to: #2628 (Research AI summary written once a day), #2627 (Markets blank cells). A line whose PR misses the tag is removed. */
    date: '2026-11-19',
    tag: 'v2026.11.20',
    items: [
      "Research: the AI summary now loads instantly.",
      "Markets: blank cells replace 'No data' when buy pressure is missing.",
      "Arena: the strategy panel no longer jumps when you tap a chip.",
      "Briefing: the ETF flow always shows its date.",
      "Session windows use plain names everywhere.",
    ],
  },
  {
    /* DRAFT, the release after v2026.11.18.2 (PM 2026-11-18). Tag and date are set when THIS release is tagged: the date must be the tagged commit's %cs.
       Plain words, 12 words or fewer per line (rule 22); only user-visible changes. Tied to: #2565 (Arena header), #2569 (your language), #2567 (bot commands,
       quiet hours, snooze, plan-lapse message), #2574 (inline mute), #2572 (daily summary, test alert), #2576 (multi-timeframe rows), #2578 + #2583 (speed),
       #2584 (S/R flip), #2587 (chart key, password reset), #2586 (AI use given back), #2590 (Telegram language), #2597 (reads use the picked strategy), #2598 (funding squeeze), #2599 (chart drawings), #2603 (rules on real data), #2604 (why a strategy cannot run), #2609 (stock hours), #2612 (summary cap), #2613 (BTC crowding), #2607 (EMA stack), #2608 (session sweep), #2610 (needs-candles reason), #2611 (reads on every coin), #2614 (fixed read levels), #2618 (no-setup chip). A line whose PR misses the tag is removed. */
    date: '2026-11-19',
    tag: 'v2026.11.19',
    items: [
      "The Arena header is one short row.",
      "The Arena and AI reads appear in your language.",
      "Telegram: /status, /pause, /resume and /help commands.",
      "Set quiet hours or snooze alerts from the Alerts page.",
      "Mute an alert type for 1 or 4 hours from Telegram.",
      "Daily summary at the hour you choose: top coins and squeezes.",
      "Send yourself a test alert from the Alerts page.",
      "Telegram tells you when your plan's alerts pause.",
      "Telegram alerts arrive in your language.",
      "Multi-timeframe alignment hides timeframes with no reading.",
      "The homepage, Arena and Funding pages load faster.",
      "The S/R flip strategy now signals when a broken level is retested.",
      "Tap ? on the Arena chart to see what each label means.",
      "Resetting your password signs out your other devices.",
      "AI tools that fail to answer give your use back.",
      "Strategies draw what they are watching on the chart.",
      "Strategy rules were re-checked against real market data.",
      "A strategy that cannot run on a timeframe now says why.",
      "Tokenized stocks: session strategies read US market hours only.",
      "Funding squeeze compares funding and open interest with each coin's own history.",
      "Quick and Deep reads use the strategy you picked.",
      "BTC crowding now includes the share of accounts long.",
      "Telegram daily summary shows the top 10 setups.",
      "EMA stack signals when the stack forms, not on pullbacks.",
      "Session sweep signals once per session and direction.",
      "A strategy with too few candles says how many it needs.",
      "Quick and Deep reads cover every listed coin, stocks included.",
      "Quick and Deep quote the same support, resistance and taker levels.",
      "A waiting strategy with nothing to draw says so on the chart.",
    ],
  },
  {
    /* RELEASED: v2026.11.18.2, tagged on c18bd4f8 (merge of #2575), whose %cs is 2026-11-19, so the date is 2026-11-19 while the tag name keeps 11.18 (the
       changelog test checks the date against the tag). Plain words, 12 words or fewer per line (rule 22); only user-visible changes. Tied to: #2553 (chart
       after an idle tab, live feeds reconnect), #2555 + #2562 (data stays visible, no data-gap dashes), #2544 + #2549 (AI read at a glance), #2559 (AI accuracy,
       incomplete answers not charged), #2545 (shorter text), #2551 (alert line removed), #2560 (Telegram delivery), #2561 (alert sounds). A line whose PR does not
       merge before the tag is removed. */
    date: '2026-11-19',
    tag: 'v2026.11.18.2',
    items: [
      "The chart no longer goes empty after the tab sits idle.",
      "Liquidation and whale-trade feeds reconnect when you return to the tab.",
      "When a source is slow, the last good value stays visible.",
      "Far fewer dashes and \"Unavailable\" where data was missing.",
      "AI reads open with one summary line and up to three reasons.",
      "Fixed AI reads that read long/short positioning backwards.",
      "An AI answer that comes back incomplete is not charged.",
      "Telegram alerts retry instead of being lost.",
      "Old signals are no longer sent when you switch on a timeframe.",
      "Macro headlines have their own alert switch.",
      "Choose from 8 alert sounds, the volume and what plays, in Settings.",
      "Labels and tips across the app are shorter.",
      "New strategy for day trading: Break of structure + FVG.",
      "Page headers are one line, without the extra sentence.",
    ],
  },
  {
    /* DRAFT, v2026.11.18 (PM 2026-11-18): the release after v2026.11.17. THE DATE MUST BE THE TAGGED COMMIT's %cs (the changelog test checks it): set it when the tag is made. Plain words, 12 words or fewer per line (rule 22); only what actually merged is listed; the Arena strategy lines are added as each of those PRs merges. */
    date: '2026-11-18',
    tag: 'v2026.11.18',
    items: [
      "The landing page fits phones and loads faster.",
      "Sign-in pages have their own titles; menus close with Escape.",
      "The news ticker has a pause button; low-contrast text is fixed.",
      "AI reads no longer contradict the EMA, SMA or VWAP numbers.",
      "HYPE now shows VWAP, RSI and volume levels.",
      "The Funding page no longer says Binance is unavailable for HYPE.",
      "Missing readings show \"No data\" or \"Unavailable\" instead of \"Mixed\" or loading.",
      "The landing headline says \"NO SETUP YET\" when there is no setup.",
      "Ask AI is hidden on the Arena on phones.",
      "The dashboard explains the A to F coin grades.",
      "The conditions score now shows a direction.",
      "The Arena EMA card shows one verdict.",
      "The breaking ticker carries only market-moving news.",
      "Long/short shares now say which exchange they come from.",
      "Slow or failed market reads end with a clear message.",
      "The Strategy panel is smaller: the run buttons fit on the first screen.",
      "Chart layers (EMA ribbon, RSI and more) are switches you set in the panel.",
      "EMA ribbon and RSI lengths are adjustable; the defaults are unchanged.",
      "Tapping a locked Quick or Deep button opens the Pro sheet for that coin.",
      "Draw Structure now draws the Channel strategy's box: entry, stop and target.",
      "Stop and Target labels stay on screen when a level is off the chart.",
      "AI reads use your indicator settings.",
      "Five new strategies: EMA cross, S/R flip, range bounce, fair value gap, session sweep.",
      "The strategy menu is grouped: Trend, Price action, Sessions.",
      "Two Derivatives strategies: funding and open interest squeeze, and CVD absorption.",
      "One short \"With Pro\" line per page replaces repeated upgrade prompts.",
      "The Upgrade page lists the new strategies, layers and AI settings.",
    ],
  },
  {
    /* DRAFT, NEXT RELEASE (written 2026-11-17 while QA is blocked; HELD for QA's word). THE TAG (v2026.11.17) AND THE DATE (2026-11-17) ARE FINAL (PM): the date must be the TAGGED COMMIT's %cs
       (the changelog test checks it). Grouped as: payments and AI usage, alerts and Telegram, data accuracy, honest wording, speed, screens, translations. Plain words only; not listed on
       purpose: tests, label migrations, database grants, the collector internals and every other internal change. Tied to the PRs (2026-11-17): #2432 #2433 #2436 #2437 #2438 (AI use given back, our-fault 503,
       unknown plan, per-user block), #2463 (Free AI allowance), #2466 (Free keeps one indicator), #2423 #2424 #2429 (payments), #2455 #2458 #2425 #2426 (Telegram, alerts), #2454 #2449 #2445 #2450 #2451 #2446
       #2453 #2442 #2444 #2447 #2448 #2443 #2456 #2435 (data), #2452 #2457 #2417 #2418 #2409 #2419 (wording), #2471 #2393 #2422 (speed), #2465 #2464 #2403 #2405 #2413 #2434 #2467 (screens), #2397 #2410 (languages). */
    date: '2026-11-17',
    tag: 'v2026.11.17',
    items: [
      'If an AI read never reaches you (the AI service refuses, times out or answers with nothing usable), the use it would have counted is now given back, on every AI tool and the chat.',
      'A problem on our side no longer shows as "you reached your limit": it now says the service is unavailable and asks you to try again, and an account whose plan could not be read is no longer counted against the Free allowance.',
      'Free and trial accounts can now use their full advertised daily AI allowance.',
      'A Free account keeps to one indicator at a time even if an earlier trial or Pro plan saved more: the chart, the AI read and the chat use only the first one, and your saved list comes back if you upgrade.',
      'Payments: a buyer who paid and signed up later still gets the paid time, a payment claim now stays open for a year, and a failed payment notification no longer loses the payment.',
      'Connecting Telegram now shows which account the link will join and asks you to confirm, and a /stop command unlinks the chat.',
      'An alert that was delivered is switched off at once, a send that failed is not counted as delivered, and if your alert settings cannot be read the signal alerts pause instead of falling back to defaults.',
      'Correlations line up the same time periods, skip coins with too little data and drop the candle that is still forming; the economic calendar shows an actual figure only for the release it belongs to.',
      'Funding rates quoted for other than 8-hour contracts now show their 8-hour equivalent, so the Funding page compares like with like.',
      'The Scanner says "Not enough data" for a coin with fewer than two readings instead of calling it balanced, and the squeeze score now counts only real signals: scores are lower and fewer coins get a direction.',
      'Candle patterns are read from closed candles only, a long wick is named Hammer or Shooting star only after the trend that gives it that name, and taker flow uses only the latest 2 hours.',
      'The 24-hour high and low of PEPE and BONK use the right price scale, the Markets table keeps coins with no data at the bottom, and the news page reads dates, duplicates and wording more carefully (a delayed or denied ETF reads as bad news, ordinary words no longer tag the wrong coin).',
      'The Briefing no longer shows missing or old data as current (calendar, ETF flows, dominance), and the on-chain read uses our own live price.',
      'Setup, funding and legend wording now states positioning (who is paying, which side is crowded) instead of predicting or telling you what to do; the AI tools, the Briefing, the macro read and the research cards describe conditions and no longer advise on position size.',
      'The dashboard Market Read says how many signals agree, BTC Risk Level is now BTC Long Crowding with its inputs named, and the stablecoin card shows its figures first.',
      'Pages that waited for every read before showing anything now paint at once: the Correlation matrix fills in coin by coin, the Funding table shows from the market snapshot first, and a slow or failing read ends with a plain message instead of a wait.',
      'Market and RSI reads show the last answer straight away while a fresh one loads in the background, and some large market replies are much smaller.',
      'The Strategy indicator chips respond at once on every tap, the number badges are gone and one thin accent border marks a chip that is on.',
      'The News events table keeps its Impact column (High or Medium for each event), the Arena toolbar stays on one row on wide screens, usage rings have readable colours, the trial banner is shorter on phones, and several small phone and accessibility fixes.',
      'The sign-in page no longer shows a red security-check error while the check is simply waiting for you, and coins without a logo show a plain placeholder instead of a broken image.',
      'More of the app speaks your language: the Arena, the footer, signed-out Settings, the macro strip, the economic calendar and the EMA card now use the translated text in Korean, Chinese and Russian.',
    ],
  },
  {
    /* v2026.11.16b, a one-fix patch on v2026.11.16 (tagged 2026-11-17 by the tagger's local date, a70a1976). Binance moved its futures streams to a new address and the old one still connected but sent nothing, so the Binance side of the liquidation feed, the liquidation map history and the whale feed had gone quiet. Wording from PM. */
    date: '2026-11-17',
    tag: 'v2026.11.16b',
    items: [
      'Binance liquidations and large trades show again on the liquidation feed, map and whale feed.',
    ],
  },
  {
    /* v2026.11.16 (was written as v2026.11.15; the release slipped past the tagger's local midnight). Written before the tag is cut, so whoever tags checks the date against `git tag --points-at main` (the tagger's local date, the same rule as v2026.11.14's entry). C1 permits exactly one untagged entry in
       flight, and this is it.

       EVERY ITEM IS A SURFACE A READER LOOKS AT, tied to its pull requests: #2358 (one Strategy set menu), #2366 + #2369 (the smaller call box, its Expand arrow, the loading and unavailable states),
       #2365 + #2371 + #2368 (the Arena layout holding its place), #2366 (the phone meter). ONE RELEASE, ONE TAG: release 2 never shipped on its own, so the batch that followed it is folded into this entry
       (PM, 2026-11-16): #2372 (strategies drawn on the chart), #2389 + #2399 (nothing waits for ever; the dashboard headline wording), #2390 (Learn link, the dashboard card heading), #2385 + #2375 (language and
       background tabs), #2404 (alert tags off the toolbar), #2401 + #2406 (the plan no longer misread while it loads), #2379 + #2380 (Hours and Playbook wording), #2370 + #2367 + #2384 + #2386 (phone layout).
       Not listed on purpose: every test, doc, label migration, database grant
       and security-hardening commit in the range, which are internal.

       THE LAYOUT LINE SAYS "MUCH LESS", NOT "NEVER", because the deployed-qa gate decides what is true and this entry is written before it. PM: make it stronger only if the gate reads all cells under 0.1. */
    date: '2026-11-16',
    tag: 'v2026.11.16',
    items: [
      'The Strategy card in AI Arena is replaced by one Strategy set menu: Let the read choose, the seven strategies, or Custom. Pick a strategy and its call, buy, sell or wait with the reason, sits right under the menu. Picking one never switches off the indicators you already have on, and Bollinger squeeze breakout adds Bollinger Bands.',
      'The strategy call is smaller and answers first: the verdict and the reason, then a one-line description that opens with an arrow beside it. While a call loads you see a placeholder in its shape, and if the candles cannot be read it says so and offers a Try again button.',
      'The Arena page now jumps around much less while it loads: the usage meter, the Set Alert button, the Upgrade button in the page header, the cookie bar and the panels on the right hold their place instead of pushing the chart down.',
      'On phones the usage meter hides its reset time so the Upgrade button fits; the reset time is still in the message you see when you reach a daily limit.',
      'Pick a strategy in AI Arena and the chart now draws it: the levels the call is built on, a marker where it triggers and a "wrong if" level where the idea stops holding. Labels that would land on top of each other stack instead.',
      'Pages no longer wait for ever. If prices, a panel, an AI read or the sign-in check cannot load, you now get a plain message after a short wait instead of a skeleton or a button that stays disabled; a few slow AI panels can still take a moment to fill in. Strategy calls on the weekly and monthly chart now say they are not available there.',
      'The dashboard headline now describes the market instead of telling you what to do: "Most signals agree", "Signals are mixed" or "Few signals agree", with a line saying it is a description, not advice. The card that read "Best Setup Today" is now "Playbook idea of the day".',
      'New to trading? There is a Learn link in the footer and, on larger screens, in the navigation, plus a line under the buttons on the home page that points to the glossary.',
      'Your language arrives sooner after a quiet period, and pages stop refreshing market data while their tab is in the background and catch up when you come back.',
      'Price-alert tags on the Arena chart now sit on the chart itself, so they no longer push the chart down when they appear.',
      'A paid plan is no longer mistaken for a free one while it is still loading: in the first seconds after you open AI Arena, tapping a fast timeframe says "Checking your plan…" instead of offering an upgrade, and the indicator chips are held (with the same note) instead of changing your saved indicators.',
      'The Hours and Playbook pages no longer make claims we cannot back: the descriptions say when a window is, not what price will do, and the Playbook says it is trading folklore, not measured results.',
      'Phones: the Setup panel no longer covers the Ask AI button, the Upgrade buttons are easier to tap, and the trending chip on the Arena signal card no longer widens the page on a very small screen.',
    ],
  },
  {
    /* v2026.11.12. Written before the tag is cut, so whoever tags checks this against
       `git tag --points-at main` rather than against the day they are working. C1 permits exactly
       one untagged entry in flight, and this is it.

       EVERY ITEM IS TIED TO COMMITS IN `main..dev` (63 non-merge commits), found by reading that
       range and the commit BODIES rather than the subjects. Mapping, in the order below:
         f54947fd + 8e712904 + e41fcbe9   coins outside the default list now work in Arena
         3e78d6cb                         older candles on scroll-back
         95419f56                         1h open interest for every perp
         afa9f259 + e526e6af + ed80f87f   the open-interest card: right coin, named absence
         04c2617c                         VWAP is the VWAP
         cecc3be4                         the plain-English opening line
         51b18648 + d2db2ad7              internal names out of the AI text
         7b6c4acb + b700b5a2 + b2498283   Draw Structure: 1h/2h, Free lock, labelled lines
         40c06fb1 + 99410529              the EMA signal's age, and an old signal dropped
         4c7c80b4                         "couldn't load" instead of an endless skeleton
         ef455e5b                         a missing reading shown as a dash, not a number
         286bd8b0                         the Strategy panel lists only wired indicators
         f82681f1 + 42e15994              the Ask AI button's tablet overlaps
         52278a7b                         the Fear & Greed 30-day trend drawing blank

       WHO RECEIVES IT was applied to every line, which is this entry's own rule after four of five
       lines failed it last release. Each surviving line names a surface a reader looks at and a
       difference they can observe on it.

       ONE LINE WAS CUT BY THAT TEST, AND IT IS THE REASON THE TEST EXISTS: the onboarding tour's
       "scanning the major coins in real time" claim (71dce059). It reads like an honesty fix and it
       is one - but its own body says "Production never showed this": prod's label row already
       carried honest wording, and a row beats the shipped default. The claim only ever appeared on
       qa and staging. A line here would have told users we fixed something they never saw, which is
       the same shape as last release's chips line - a true change, falsely addressed.

       ALSO CUT, each for a stated reason rather than by category:
         7cbee7e2  only http/https links from AI text are clickable. Real hardening, but nothing a
                   reader observes unless the model emitted a javascript: URL, which it did not.
         95419f56's `oiUsd` half  the field has no consumers anywhere, so no one ever saw it.
         2cefd201 + 4f88b89b + eec45195 + 1db834f4  the denomination-helper rename. Internal.
         every test(), docs() and chore() commit in the range  internal by definition.

       LINE 1 NAMES THREE SURFACES RATHER THAN SAYING "works", and the narrowing is QA's catch on
       review. "AI Arena now works for every coin it offers" overclaimed: the liquidation feed is
       still core-only by our own decision (#2133 left the liquidation feed alone - widening its subscription
       list from 50 to 462 streams is a load decision, parked on #1263), so it stays empty on XMR
       or CYBER. The first draft of this line contradicted the same PR that documented the
       exclusion. Chart, scanner and open interest are what actually changed; keep it to those
       three unless the feed is widened too.

       THE DRAW STRUCTURE LINE CARRIES THREE CHANGES and stays one line because they are one thing
       to a reader: the feature is offered on more timeframes, each line it draws is now labelled,
       and a Free account can see it exists. Splitting them would describe our PRs rather than their
       experience. */
    date: '2026-11-15',
    tag: 'v2026.11.14',
    items: [
      'The chart, the scanner and open interest in AI Arena now work for every coin it offers, not just the main list: pick something like XMR, CYBER or XAUT and the chart draws candles, the scanner shows a signal and a score, and open interest shows a figure - where before the chart sat on "Loading" and the signal columns read "n/a".',
      'The Arena chart loads older candles as you scroll left, instead of stopping at the batch it opened with.',
      'The 1-hour open interest figure now appears for every coin with a perpetual market. Most coins used to say "Unavailable" there.',
      'The 1-hour open interest card now shows the coin you are looking at rather than briefly keeping the last one, and says whether it is still collecting or could not reach the exchange.',
      'The VWAP figure on the dashboard, in Arena and on the landing page is now the VWAP. It was showing the current price under a VWAP heading. Where a coin has no VWAP it shows a dash and says so, instead of a loading bar that never finished.',
      'An AI read now opens with one plain sentence - the direction, the price that would confirm it and the price that would cancel it - above the technical detail.',
      'AI reads no longer show internal labels for a trend or a structure break. They say "trending down" and "break of structure" in plain words.',
      'Draw Structure is now offered on the 1-hour and 2-hour charts as well as 4-hour and daily, each proposed line is labelled with its kind and how many touches support it, and a Free account can see the feature with a padlock instead of not seeing it at all.',
      'The EMA signal says how many bars ago it fired and marks itself old past 50 bars, and an old signal no longer counts as agreement in the AI read.',
      'When a price or news feed fails, the setup scanner, the accumulation and distribution panels and the News tab say they could not load, instead of showing a loading bar for as long as the feed stays down.',
      'A reading that has not arrived is shown as a dash rather than a number. The landing page printed "Setup 0" next to its own "No data" note, and the Confluence Score counted the EMA ribbon as a neutral vote while it was still loading, pulling the score toward zero.',
      'The Strategy panel lists only indicators that are actually calculated. More than half its entries drew nothing.',
      'On tablets, the floating Ask AI button no longer sits on top of the bottom navigation bar or the playbook favourite star.',
      'The 30-day Fear & Greed trend no longer shows a blank space when a short cached history is in play.',
      /* ADDED AFTER THE GROUP MERGE, each tied to its pull request. Every line names a surface a reader looks at
         and a difference they can see on it; internal work in the same range (the label-key moves, the rate
         tables, the engine-switch scaffolding that nothing reads yet, CI and tests) is left out on purpose.
           TradFi universe + category tabs      #2182, and the warning sentence on it, #2196
           Strategy panel redesign + chip names  #2162 #2184
           1W / 1M timeframes                   #2157
           markers follow the indicators         #2159
           AI read gets the indicator values     #2161
           landing hero on tablets               #2175
           landing hero loading + partial score  #2167 #2185
           funding rate fallback                 #2186
           chart pattern pills                   #2187
           deep link to a non-core coin          #2150
           landing clock                         #2151
           signed-in visitors skip the landing   #2154
           open interest survives one venue      #2149
           cold-load price skeleton              #2169
           News "For You" empty state            #2152
         THE FIRST FIVE OF THE LAST GROUP WERE CHECKED NOT TO BE IN origin/main (2026-11-13, main = v2026.11.10), so
         they ship in this release.
         THE NEWS "FOR YOU" LINE (#2152) WAS HELD AND IS NOW LISTED: production's label row overrides the shipped
         text, so a user only sees the change once that row is written. The owner approved the row ("No catalysts
         right now", five locales) first-hand to PM on 2026-11-13, and PM applies it at release time after the render
         check. IF THE ROWS ARE NOT APPLIED BEFORE THE TAG, THIS LINE COMES OUT - copy says only what a user can see.
         IF ANY OF THESE DOES NOT REACH THE RELEASE, ITS LINE COMES OUT HERE - copy says only what ships. */
      'AI Arena now includes tokenized stocks, ETFs and commodities, plus a currency pair, under new Stocks, ETFs and Commodities & FX tabs. Each one says what it is, and a note explains that the contract trades around the clock while the market behind it keeps its own hours. A few carry a warning: Hong Kong listings are priced in HK$, and two pre-IPO references where exchanges disagree on the price. AI reads are not offered for them.',
      'The Strategy panel is simpler. Pro and trial accounts can switch on as many indicators as they like with no counter, and a Free account picks one at a time, tapping another to swap it in. Each indicator (SMA, Parabolic SAR, MACD, Bollinger Bands) has a one-line description, and the chart layers sit in their own section with on/off switches for support and resistance and for liquidation clusters.',
      'The Arena chart now has 1W and 1M timeframes. Signals, the AI read and Draw Structure still cover up to the daily chart, and the weekly and monthly views say so.',
      'The buy and sell markers on the Arena chart now follow the indicators you have switched on: a marker shows only where they agree with the EMA ribbon, and the chart says when your selection has filtered some out.',
      'The AI read now receives the readings of the indicators you have selected, such as the SMA, Parabolic SAR, MACD and Bollinger values, instead of only knowing their names.',
      'On tablets, the landing page no longer cuts off the live read panel (stop, target, the clock and the notes beneath it) or splits its buttons over two lines.',
      'The landing page shows a dash while market data is still arriving, and says "Unavailable" or "No data" only once the read has finished or failed. Its Setup score now appears from the first signal with an "N of 3 signals" note, and gives a verdict only when all three are in.',
      'The funding rate in AI Arena now falls back to a second exchange when the first does not answer, instead of showing unavailable.',
      'When an AI read lists several chart patterns in one line, such as "Double top; Tight consolidation", they now show as separate labels.',
      'AI Arena links to coins outside the main list, such as /arena?coin=cyber, now open that coin instead of silently loading Bitcoin.',
      'The clock on the landing page\'s live read panel no longer shows a time an hour old.',
      'If you are already signed in, the landing page no longer flashes on screen before taking you to the app.',
      'The 1-hour open interest card stays up when one exchange limits our requests: it falls back to the other exchange instead of going blank.',
      'If the live price connection fails when you first open the app, it now switches to its backup price feed straight away, so prices appear within seconds instead of a loading skeleton lasting about half a minute.',
      'When nothing in the news matches your coins, the For You tab now says "No catalysts right now" instead of looking like it is still loading.',
      /* ADDED AFTER #2188, each tied to its pull request. Same rule as the lines above: each names a surface a reader
         looks at and a difference they can see on it, and IF ANY OF THESE PRS DOES NOT REACH THE RELEASE ITS LINE COMES
         OUT HERE.
           price alerts: main coins only, with a note        #2197
           Draw Structure on phones                          #2202
           AI Arena opens on the saved coin and timeframe    #2205 (open when written: out if it does not merge)
           Draw Structure menu closes, lines stay            #2192
           chart tag overlap + stray asterisks, one line     #2200 #2206 (#2206 open when written: if it does not
                                                              merge, the asterisks half comes out)
         LEFT OUT ON PURPOSE: the Chart Layers spacing next to the Ask AI button (#2207), which is spacing, not a change
         a reader would name. */
      'Price alerts in AI Arena are now offered for the main coins only, and the Set Alert button says so, instead of letting you set an alert on a coin that could never trigger.',
      'Draw Structure now works on phones. The button was hidden on narrow screens; it is back, with a menu that fits the screen.',
      'AI Arena now opens on the coin and timeframe you saved in Settings when you load it fresh, instead of Bitcoin on 15 minutes.',
      'The Draw Structure menu now closes with Escape or a tap outside it, and the lines it drew stay on the chart.',
      'Two small chart fixes: the liquidation price tag at the chart edge is no longer drawn over a nearby support or resistance tag, and text an AI read puts between single asterisks now shows in italics instead of with stray asterisks.',
      /* ADDED AFTER #2236, each tied to its pull request. Same rule as above: IF ANY OF THESE PRS DOES NOT REACH THE RELEASE ITS LINE COMES OUT HERE.
           whale BUY/SELL + Research stacks on phones   #2228 (4b, 6b)
           nothing sits under the Ask AI button          #2228 (playbook star), #2229 (dashboard new play), #2238 (liquidation map Total)
         LEFT OUT ON PURPOSE: the shared sign-in deadline in #2241 (it stops waiting a few seconds sooner and shows nothing new, QA measured), the error-report privacy tightening in #2239 (internal, and too technical for a reader), the chart feed dot's accessible name and the darker /funding chip colour inside #2228, which are small
         accessibility and contrast changes a reader would not name. */
      'The whale feed now says BUY or SELL on every large trade, and the Research page stacks its first two cards on phones so no number is cut off.',
      'The floating Ask AI button no longer sits on top of the playbook favourite star, the dashboard "new play" button on phones, or the Total column of the liquidation map clusters table.',
      /* ADDED AFTER #2245, each tied to its pull request. Same rule as above: IF ANY OF THESE PRS DOES NOT REACH THE RELEASE ITS LINE COMES OUT HERE.
           coin list: loading / Unavailable / prices that were blank   #2245 (merged)
           landing ticker and Live Read card states, Coinbase premium   #2246 (merged)
           link to a coin we do not list says so                          #2247 (merged)
         #2248 (open when written: out if it does not merge): a Deep read that cites no catalysts says so.
         #2252 (merged): the /ko /zh /ru home pages are fully in their language; the legal text stays English on purpose.
         #2253 (merged): the scanner says "No data" in plain words on phones, card titles wrap, and Russian no longer scrolls sideways.
         ADDED AFTER #2254, grouped (each line comes out if ANY of its PRs does not reach the release; PM 2026-11-13; #2250 and #2251 get no line):
           missing figures say loading or No data, never a dash (dashboard cards, BTC dominance and alt-season cells, coin prices, funding table, Markets page prices and buy pressure; a price change that is not known draws nothing)   #2256 #2261 #2262 #2263 #2283 (merged)
           card notes and market-read tiles wrap instead of ending in an ellipsis; the Markets page's column heads, long prices and row lines fit on phones   #2255 #2264 #2269 #2284 (all merged; KEEP the heads wording only because #2284 merged)
           dashboard, market read, session clock and holidays, Ask AI chat and funding in ko/zh/ru; Russian in the home page menu, and the short words (funding, setup, Fear & Greed, chart patterns) follow the language (Arabic is not offered in any picker, so it is not named)   #2257 #2258 #2259 #2260 #2266 (open when written)
           coin names easier to tap on phones (KEEP ONLY IF QA's /markets 24 px measurement lands after the promotion; funding and dashboard are measured)   #2254 (merged)
           Best Hours shows 24-hour times and local weekday names in Korean, Chinese and Russian; its ranges and axis fit on phones   #2267 #2268 (both merged)
           SECOND BATCH (PM 2026-11-14), each line out if its PR does not reach the release; #2270, #2273, #2274, #2275, #2277, #2278 and #2280 get no line because a visitor cannot see them (#2273 only changes a server log message), and #2276 (the Alert Track Record states how far back it reaches) gets none because that card only shows with SHOW_PERFORMANCE_STATS, which is off by the owner's order (#1574), so no user sees it:
             the selected coin in the Arena list is marked beyond colour   #2271 (open when written)
             on desktop the collapsed Setup button sits beside the Ask AI button   #2272 (open when written)
             Hong Kong stock prices show HK$ on the coin page, including the VWAP card and the EMA entry line   #2281 (merged)
         NOTE: the stale "n/a" wording of the #2245 line is corrected below to match what #2253 shipped ("No data"). */
      'In the AI Arena coin list, a price that has not arrived shows a loading mark, and one that cannot be found says "No data" in plain words, instead of a dash that could mean either. HYPE, FET and several commodities now show a price even when one exchange cannot be reached, and coins with no signals say "No signals" instead of "n/a".',
      'On the landing page, the price ticker and the Live Read card now say "Unavailable" or show a loading mark instead of a bare dash, and the card shows the Coinbase premium.',
      'An AI Arena link to a coin we do not list now says so and opens Bitcoin, instead of switching to Bitcoin without a word.',
      'A Deep read that gives price levels but cites no catalysts now says so, instead of leaving a gap.',
      'The Korean, Chinese and Russian home pages are now fully in their language: the start button, the Live Read card and the cookie notice. The legal text at the bottom stays in English.',
      'On phones, the AI Arena coin list says "No data" in plain words when a price is missing, instead of a dash, and the Russian page no longer scrolls sideways.',
      'Missing figures now show a loading mark, "Unavailable" or "No data" in plain words instead of a dash: the dashboard cards, coin prices, the Markets page prices and buy pressure, and the funding table. A price change that is not known no longer shows as +0.00%.',
      'Card titles, the notes under card values and the market-read tiles now wrap onto a second line instead of being cut off with "...", and the Markets page column heads, long prices and row lines fit on a phone.',
      'Most of the dashboard, the market read, the session clock and market holidays, the Ask AI chat, with their short words such as funding, Fear & Greed and chart patterns, now speak Korean, Chinese and Russian, and Russian is offered in the home page language menu.',
      'Coin names on the funding, markets and dashboard pages are easier to tap on phones.',
      'Best Hours now shows 24-hour times and weekday names in your own language in Korean, Chinese and Russian, and its time ranges and chart axis fit on a phone.',
      'The selected coin in the Arena coin list is now marked with a bar as well as a colour.',
      'On desktop the collapsed Setup button now sits beside the Ask AI button instead of over the page.',
      'Prices of Hong Kong stocks now show HK$ on the coin page, including the VWAP card and the EMA entry line.',
      /* ADDED FOR THE 2026-11-14 PROMOTION (PM). Same rule as above: each line names a surface a reader looks at and a difference they can see on it, and IF ANY OF THESE PRS
         DOES NOT REACH THE RELEASE ITS LINE COMES OUT HERE. The DATE of this entry is a placeholder PM sets on release day.
           seven Arena strategies                                  #2307 #2308 #2311 #2313 #2314 #2315 #2316
           sound alerts on the Arena                               #2304 (needs its labels applied; the prompt and the Settings row read them)
           "Signals, not predictions" on Alerts and Telegram        #2299 (the Alerts page line needs its label row; the Telegram footer is in the code)
           AI chat answers show links and formatting safely         #2326
           Privacy page: deletion on request                        #2323 (needs its label row)
           small links and buttons easier to tap                    #2309
           the upgrade page no longer flashes for Pro accounts      #2305
           landing hero stays in one column up to wider screens     #2303
         LEFT OUT ON PURPOSE, each because a visitor cannot see it: the alert outcome logging, the request-size and input checks, the admin and
         honeypot changes, the rate limiter, the push and subscription handling, the error-report filtering, and the Telegram send route. */
      'AI Arena has seven strategies to choose from in a new Strategy card: Liquidity sweep and structure shift, New York open breakout, EMA 20/50/100/200 stack (it enters on the pullback), Supply and demand zone retest (with a BTC check on other coins), Bollinger squeeze breakout, VWAP reclaim and RSI divergence. Each reads Buy, Sell or Wait from closed candles only, says why in plain words, and says it is a signal, not a prediction. Your choice is saved with your account.',
      'AI Arena can now play a short sound when the strategy signal for your coin and timeframe turns to buy or sell, and once per candle on an unusually big, high-volume move. It asks you first, and you can switch it off any time in Settings.',
      'The Alerts page and every Telegram signal alert now say plainly: signals, not predictions, and that past alerts moved the alert\'s way about half the time at 24 hours.',
      'Links and formatting in AI chat answers are now handled more carefully, so a link in an answer only opens if it is a normal web address.',
      'The Privacy page now explains that your personal data is removed from our active systems within 30 days of asking us to delete your account.',
      'More small links and buttons are easier to tap on phones: coin names on the Markets page, the support email address, and the About link at the bottom of the Disclaimer.',
      'If you are on Pro, the upgrade page no longer shows an "Upgrade to Pro" button for a moment before sending you on.',
      'On laptop-width screens the landing page keeps its one-column layout until the screen is wide enough for the live read panel to fit beside the text.',
    ],
  },
  {
    /* v2026.11.10. Written before the tag is cut, so whoever tags checks this against
       `git tag --points-at main` rather than against the day they are working.

       EVERY ITEM IS TIED TO A COMMIT IN `main..qa` (22 non-merge commits), found by reading that
       range rather than by taking PM's release note. Mapping, in the order below:
         b0e2c517 + 59d269ac + 103a7900 + a82342a1 + 5caabc6f   the post-purchase screen
         4d396e41  the coin category chips signalling selection by colour alone
         1b3d055c + a472e9ce  the failure state for a paid read that came back unreadable

       A THIRD LINE WAS CUT - the chart-alerts one - AND THAT MAKES THIS THE ENTRY'S DEFAULT RATHER
       THAN ITS EXCEPTION. It read "a chart-alerts refresh that fails now says it failed, rather than
       looking like you cancelled it", mapped to 7250b91c. That commit's failure branch is a
       `console.error` and a `return`: no `setChartSyncIssues`, no `setChartAlerts`, no toast, and it
       does not join the "Couldn't draw:" path. **The commit body says so itself** - "The behaviour a
       user sees is UNCHANGED and that is deliberate." Nothing is written to the page, and nothing in
       app/, components/ or lib/ reassigns console.error to surface it.

       THE WORDING WAS WRONG A SECOND WAY, which is worth keeping separate from the first: "rather
       than looking like you cancelled it" tells a reader they appeared to cancel something. They
       cancelled nothing - `cancelled` is the effect-teardown flag for a coin change or unmount. The
       line handed a reader an internal variable name as their own action, so it was untrue even for
       someone reading the console.

       FOUR OF THE FIVE DRAFTED LINES FAILED THE SAME TEST, which is the number that matters: the
       pulled Telegram line, the "in your language" clause, this one, and the chips line below. Not
       four slips - one missing step.

       THE CHIPS LINE IS THE SUBTLEST OF THE FOUR AND THE MOST WORTH STUDYING, because it was half
       true and the true half carried the false one. It read "marked for screen readers AND no longer
       shown by colour alone". The first clause is exactly right - 4d396e41 adds `aria-pressed`. The
       second announces a visual fix that did not happen: that commit's body says "No visual change",
       it adds no class, colour or style, and a sighted reader who could not distinguish the states
       before still cannot. Pairing a verified clause with an unverified one is how the unverified one
       gets through - the line reads as checked because half of it was. Every one of them described what a change makes POSSIBLE or what it writes
       SOMEWHERE, rather than what a reader can observe. And this one survived two rounds of review
       sitting four lines below the comment diagnosing the habit, which is the strongest argument
       that noticing the habit does not substitute for the check.

       THE MISSING STEP, now stated so it is inherited rather than re-derived: before an entry ships,
       make one pass over `items` and ask of each line WHO RECEIVES IT. An operator health row, a
       console line and an untranslated key all fail that question, and all three looked fine while
       being read as a list. The three lines that remain were each put through it - the /upgrade
       confirmation is a screen (QA verified 6/6 on qa), the chips item is a rendered
       `aria-pressed` attribute, and the bad-read item is label copy a reader sees.

              "IN YOUR LANGUAGE" WAS CUT FROM THE THIRD LINE, and this is the SECOND false claim this entry
       had on review. Both are recorded because the cause is one habit, not two slips.

       The line said the unreadable-read message is now shown "in your language". It is not.
       `ARENA_READ_BAD_ANSWER` has **no row in any locale** - checked against every migration, with
       `ARENA_COIN_LOCK_LINE` as a positive control (11 hits, so the search does find translated
       keys). QA measured the same thing from the deployed build with /api/labels: the key is absent
       at en, ru, ko and zh, so `LabelsProvider`'s `{ ...DEFAULT_EN_LABELS, ...data }` leaves the
       English default standing for everyone. The 114-key gap between the en and non-en responses is
       what makes that a finding rather than a guess - the translation mechanism is live and in use,
       this key just is not in it.

       WHAT #2065 ACTUALLY DELIVERED is one step short of what the line claimed: the message used to
       be GROK_UNREADABLE_ANSWER_MESSAGE, a hardcoded English server string that never reached the
       label table, and it is now a label key. So it went from UNTRANSLATABLE to TRANSLATABLE. That
       is a real improvement and it is not the same as translated.

       THE HABIT BEHIND BOTH ERRORS: describing what the change makes POSSIBLE rather than what a
       reader can observe today. Line 5 announced an operator health row as if a user saw it; line 3
       announced a translation mechanism as if it had been used. The owner's rule is that copy says
       only what the product does today, and "translatable" fails it in the same way "degraded row
       exists" did. Neither was caught by a test; both were caught by someone asking who receives it.

       A FIFTH LINE WAS DRAFTED AND PULLED, and it is recorded because the mistake is instructive
       rather than clerical. It read "Telegram alerts now say when a pass ran on incomplete market
       data, instead of going quiet", mapped to f00d5326. **No user is told anything by that commit.**
       Its "alerts degraded: ..." string goes to `reportHealth`, which writes an internal health row
       for /ops; no Telegram message text changes. Caught by PM/DevOps on review.

       The error was reading a commit's most quotable new string as user-facing without checking who
       receives it - the same shape as announcing the /hours wording below while database rows still
       serve the old copy. A changelog line's test is not "did something change", it is "would a user
       notice", and an operator-facing row fails it.

       WHAT THIS RELEASE DOES DO FOR ALERTS IS REAL BUT NOT YET HERE: f00d5326's closed-candle cache
       plus #2080's pacing make the alert pass call exchanges less often and evenly spaced, which is
       what stops the breaker tripping and alerts stopping for 10-20 minutes. #2080 is NOT in this
       range, so the line is held rather than written against a commit that is not shipping. If #2080
       lands before the tag, add: 'Telegram alerts make fewer, evenly spaced requests to exchanges, so
       they are less likely to stop during busy markets.' mapped to f00d5326 + #2080's commit.

       THE POST-PURCHASE ITEM COVERS FIVE COMMITS, NOT ONE, and that is the Russian-item lesson in
       the entry below being applied rather than re-learned: b0e2c517 built the confirmation,
       59d269ac gave the signed-out buyer a Sign in button that keeps the marker, 103a7900 fixed the
       marker losing a race with the redirect, a82342a1 fixed the prerender it broke, and 5caabc6f
       fixed a Pro buyer being stuck on "Redirecting..." forever with the confirmation unreachable.
       Naming only b0e2c517 would have pointed a reader at a screen that, until 5caabc6f, they could
       not actually reach.

       WHAT IS DELIBERATELY NOT HERE. Thirteen of the 22 commits are tests, docs, a CI build fix and
       the dev half of a migration - rule 2, nothing a user can see. And `20261108a` (the /hours
       wording) is NOT announced even though it merged: all five HOURS_WIN_%_DESC keys have an `en`
       row in `lhq_labels`, rows beat shipped defaults, so /hours still serves the old copy until the
       owner applies that migration. Announcing it would describe a page nobody is being shown.

       DRAW STRUCTURE IS STILL OUT, and the block below says why in full - the short version is that
       its route is live on every environment now, but the condition for announcing it was a
       confirmed real call and that counter could not be read when this was written. */
    date: '2026-11-10',
    tag: 'v2026.11.10',
    items: [
      'If you have just bought Pro, the upgrade page now confirms the purchase and offers a link onward, instead of sending you away without a word.',
      'On AI Arena, screen readers now announce which coin category is selected.',
      'When an AI read comes back without a clear verdict, AI Arena now says so plainly, and tells you whether the read was counted.',
    ],
  },
  {
    /* v2026.11.08b. The `b` suffix is a second release on the same date, which TAG_SHAPE in
       __tests__/changelogTracksReleases.test.mts already allows (`[a-z]?`). Written before the tag
       is cut, so whoever tags checks this against `git tag --points-at main`, not against the day
       they are working.

       EVERY ITEM IS TIED TO A COMMIT IN `main..qa` (27 non-merge commits), found in the range rather
       than taken from PM's release note. Mapping, in the order below:
         481eeb6a  the Ask AI button covering the footer legal line
         0915c4d1  the Telegram tick following the link instead of a test message
         340d7188  the funding row reading "loading…" before the grace ends
         9dab63a9 + 4263c010 + e15771c4 + 618afaf3  the Russian landing page

       THE RUSSIAN ITEM COVERS FOUR COMMITS, NOT ONE, and this is the mistake the entry above
       records making with Best Hours: 9dab63a9 drafted the dictionary held out of SUPPORTED_LOCALES,
       4263c010 applied PM's nine edits, e15771c4 switched it on, and 618afaf3 added `ru` to
       LANDING_LOCALES - without which /ru rendered the marketing page with the app nav over it, so
       the page a reader would visit from this line would have been visibly wrong. One sentence,
       four commits; naming only the switch-on would have been the easier mistake again.

       PM's note cited #2053, #2056, #2062 and #2061, which are the PULL REQUESTS. The commits cite
       the underlying issues - #1185, #1113, #1263/#1651 and #1740 - and those are what a reader
       chasing this release should follow.

       WHAT IS DELIBERATELY ABSENT. The daily health check (a16ffbf6, 17d91baf) and the Deep canary
       (cb32a63b and its four follow-ups) are the largest part of this range by commit count and
       NEITHER IS USER-VISIBLE: both are workflows that watch production and open issues for us.
       Rule 2 keeps this page to what a user can see on a page. Recorded so the next reader does not
       read their absence as an oversight - and the canary's schedule is still gated off, so even its
       operational effect has not started. Same for the test commits in the range. */
    date: '2026-11-08',
    tag: 'v2026.11.08b',
    items: [
      'The Ask AI button no longer covers the end of the legal line at the bottom of the page.',
      'The onboarding checklist ticks "Connect Telegram alerts" as soon as Telegram is connected, instead of waiting for a test message.',
      'The Arena\'s funding check says "loading…" while the rate is still arriving, instead of calling it unavailable.',
      'LiquidityHQ is now available in Russian, at liquidity-hq.com/ru.',
    ],
  },
  {
    /* v2026.11.08. WRITTEN BEFORE THE TAG IS CUT, which the entry above warns about - so the date
       here is the one PM/DevOps is tagging with today, and whoever tags checks it against
       `git tag --points-at main` rather than against the day they are working.

       EVERY ITEM WAS CHECKED AGAINST A COMMIT IN `main..staging` (140 commits) rather than taken
       from the release plan. The five below map to ed08d792 (footer overflow), 7fc30b61 (AI failure
       charged a read), ecf8bd5b + 1db38c13 (build-time session badge, flat series read as
       overbought), e4051c47 (playbook predictive claims) and d880f85f ("All sales are final"
       against the Terms), 8e8a589e (the /learn category links - the release's only addition) and
       f2006b25 (the journal's missing minus sign). An item nobody could point at a commit for was
       left out, and both additions were checked with `git merge-base --is-ancestor <sha> staging`
       rather than assumed to be in the release because they were recent.

       WHAT IS DELIBERATELY ABSENT, so the next reader does not think it was missed. The
       vendor-naming cleanups in this range are internal hygiene - they change which name appears in
       OUR code and logs, not anything a user reads on a page - and rule 2 keeps the page to what a
       user can see. Same reason nothing from #1818 is here: that work is on `dev` behind the
       owner's hold and none of it is user-visible in this range.

       THE BEST HOURS ITEM COVERS TWO COMMITS, NOT ONE, and the first draft of it named only the
       badge: 58c437e7 fixed the clock, the date and the needle (#1996), ecf8bd5b fixed the session
       badge (#1999). Four prerendered values, one sentence - understating it would have been the
       easier mistake, because the second commit is the one that was in front of me. */
    date: '2026-11-08',
    tag: 'v2026.11.08',
    items: [
      'The glossary now points somewhere. Each category on /learn carries a link to the tool that uses those terms - the scanner, the liquidation map, the economic calendar, the position-size calculator and the playbook.',
      'Every page could be scrolled sideways on a laptop or tablet. The row of links in the footer refused to wrap, so it set the width of the whole page - it wraps now.',
      'An AI analysis that failed still used up one of your reads for the day. It no longer does, and a database outage is no longer reported to you as a usage limit.',
      'Readings that were stale now say so. A completely flat price reads as unknown instead of maximally overbought, and on Best Hours the clock, the date, the needle and the session badge all wait for your browser rather than showing whatever was true when the site was last built.',
      'A losing trade in the journal showed its result without the minus sign.',
      'The playbook no longer states how often a setup works, how likely it is, or what it returns. Those figures were not ones we can stand behind.',
      'The note at checkout said all sales are final, which contradicted the Terms. The two now agree.',
    ],
  },
  {
    /* THE TAG IS CUT AND THIS ENTRY IS NAMED AFTER IT: v2026.11.07, pushed after the deploy and
       confirmed by `git tag --points-at` to cover the commit production is serving.

       IT MOVED TWICE AND BOTH MOVES ARE THE SAME LESSON. It was 2026-11-05 when written, then
       2026-11-06 on PM/DevOps's call because the release was expected to ship on the 6th in both
       UTC and the tagger's local date - and it shipped on the 7th. A date set from the plan is wrong whenever the plan
       slips, which is most of the time. **The date follows the tag, and the tag follows the
       deploy.** Whoever tags next should check this string against `git tag --points-at main`
       rather than against the day they are working.

       WHY THIS ENTRY GREW FROM TWO ITEMS TO SEVEN. The two it carried were written while the
       release was still a plan, from the tag subject of the moment. What actually shipped is 245
       commits off `staging`, and surveying them against rule 2 found five more things a user can
       see. An entry assembled before the release is an entry assembled from intentions. */
    date: '2026-11-07',
    tag: 'v2026.11.07',
    items: [
      'AI Arena now lists every coin tradable here, not only the main list - price and 24h change for all of them. Where a coin is not one we analyse, the page says so: no AI read, and no squeeze reading rather than a calm-looking zero.',
      'PEPE, BONK and gold had no price or chart at all on some pages. They do now.',
      'Whale alerts for PEPE and BONK quoted a price a thousand times too high, and the figure often printed as "0". Both are fixed.',
      'A page that does not exist now says "Page not found", with a larger empty chart.',
      'When market data is unavailable, an AI read on AI Arena now says so instead of answering, and it does not use up one of your reads.',
      'The economic calendar knows 2027 market holidays. Without them, every holiday from January would have shown as an ordinary trading day.',
      'AI Arena no longer shifts under you as it loads.',
    ],
  },
  {
    /* THIS RELEASE WAS LIVE WITH NO ENTRY AT ALL, which is the drift the header's KNOWN GAP
       predicted: nothing updates this file when a release ships. Added late rather than skipped,
       because a missing entry and a deliberately empty one look identical on the page.

       ITS HEADLINE IS NOT LISTED. The tag is "the operator's country and the server region leave
       every page a customer can reach", and that is 134 commits of privacy hygiene with nothing a
       reader gains from being told - announcing which details we removed about ourselves tells a
       customer nothing about the product. Rule 2 drops it.

       WHAT EARNS THE ENTRY IS THE NUMBER FORMATTING, and it took reading the commits to find:
       `priceText(NaN)` printed "$NaN", `priceText(Infinity)` printed "$∞", and
       `signedUsd(NaN, 'M', 1)` printed "-$NaNM" - inventing a minus sign from `NaN >= 0` being
       false. `lib/useEMAStrategy.ts:931` calls `priceText(sig.sl)` unguarded on a value that
       comes out of ATR arithmetic, so a stop-loss was a reachable place to see it.

       WORDED AS WHAT IT DOES NOW, NOT AS A SIGHTING. The commit that fixed it says plainly "I am
       not claiming this has been seen in production; I am saying nothing in the way stops it", so
       an entry saying users saw broken prices would be inventing a report. */
    date: '2026-10-31',
    tag: 'v2026.10.31',
    items: [
      'A price or figure the app cannot work out now shows "N/A" instead of a broken value.',
    ],
  },
  {
    date: '2026-10-30',
    tag: 'v2026.10.30',
    items: [
      'The Korean and Chinese pages now tell browsers and screen readers which language they are in.',
    ],
  },
  {
    date: '2026-10-29',
    tag: 'v2026.10.29b',
    items: [
      'Applied a security patch to the web framework the site runs on.',
    ],
  },
  {
    date: '2026-10-29',
    tag: 'v2026.10.29',
    items: [
      'Published a refund and cancellation policy.',
      'Subscribers can see and cancel their own subscription.',
    ],
  },
  {
    date: '2026-10-28',
    tag: 'v2026.10.28',
    items: [
      'AI Arena falls back to another exchange when its usual one is unavailable.',
      'Fixed the economic calendar table layout.',
      'The About page now lists where each piece of market data comes from.',
    ],
  },
  {
    date: '2026-10-27',
    tag: 'v2026.10.27',
    items: [
      'The economic calendar shows how much of the period it actually has data for.',
      'The position-size calculator can be found by search engines.',
    ],
  },
  {
    date: '2026-10-26',
    tag: 'v2026.10.26',
    items: [
      'Search-engine fixes: canonical page addresses, and language tags for English, Korean and Chinese.',
      'The Playbook page gained a proper heading.',
    ],
  },
  {
    date: '2026-10-24',
    tag: 'v2026.10.24',
    items: [
      'The site became visible to search engines.',
    ],
  },
  {
    date: '2026-10-22',
    tag: 'v2026.10.22',
    items: [
      'AI answers check their own figures before showing them.',
      'Price alerts are held until they have been delivered, instead of being dropped.',
      'Added a public health endpoint, which is what the Status page reads.',
      'Hardened sign-in and the calls the platform makes to exchanges.',
    ],
  },
  {
    date: '2026-10-21',
    tag: 'v2026.10.21',
    items: [
      'Fixed an out-of-memory crash caused by how sign-in tokens were checked.',
      'Charts and RSI now use closed candles, so a value stops changing underneath you mid-candle.',
      'Polled market data is no longer served from the browser cache.',
    ],
  },
  {
    date: '2026-10-17',
    tag: 'v2026.10.17',
    items: [
      'Fixed an AI Arena chart freeze, and a bug that drew the wrong timeframe.',
      'Added a loading state where the Arena previously showed nothing.',
    ],
  },
  {
    date: '2026-10-08',
    tag: 'v2026.10.08',
    items: [
      'Indicator chips now match what the chart is drawing.',
      'Fixed the header for signed-out visitors.',
      'Added a support contact address to the site.',
    ],
  },
  {
    date: '2026-10-06',
    tag: 'v2026.10.06.2',
    items: [
      'Reworked the plan-selection layout on the pricing page so the billing choices line up.',
    ],
  },
  {
    date: '2026-10-06',
    tag: 'v2026.10.06',
    items: [
      'Settings no longer overflows a phone screen.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01.4',
    items: [
      'Alert processing no longer stops after 1,000 records.',
      'The save confirmation moved to where it can be seen.',
      'Faster timeframes are enforced on the server rather than in the browser.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01.3',
    items: [
      'Market Read waits for all of its inputs before showing a result.',
      'AI Arena says what state it is in instead of showing a blank panel.',
      'Price alerts are paged, so a long list loads.',
      'More translated copy, and a third batch of accessibility fixes.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01.2',
    items: [
      'Fixed the dashboard grid.',
    ],
  },
  {
    date: '2026-10-01',
    tag: 'v2026.10.01',
    items: [
      'An address that does not exist now answers with a proper 404 page.',
      'Pages are served from cache again.',
      'Added loading and error states, and hints, across the app.',
    ],
  },
  {
    date: '2026-09-27',
    tag: 'v2026.09.27',
    items: [
      'Fixed product analytics so personal data is not captured.',
    ],
  },
  {
    date: '2026-09-26',
    tag: 'v2026.09.26',
    items: [
      'Market data is saved, so a panel can show the last known values when a feed is briefly unavailable.',
    ],
  },
  {
    date: '2026-09-19',
    tag: 'v2026.09.19',
    items: [
      'The Pro badge survives a sign-in event instead of disappearing.',
      'The About page gained a contact card.',
      'Completed an audit pass over AI Arena.',
    ],
  },
  {
    date: '2026-09-18',
    tag: 'v2026.09.18',
    items: [
      'Visual updates to AI Arena, and an audit of the indicators it calculates as you watch.',
    ],
  },
  {
    date: '2026-09-17',
    tag: 'v2026.09.17b',
    items: [
      'Keyboard focus indicators across the app.',
      'The macro panel no longer fills a gap with an invented value.',
      'Fixed the direction handling in the calculators.',
      'Wording corrections across all five languages.',
    ],
  },
  {
    date: '2026-09-17',
    tag: 'v2026.09.17',
    items: [
      'Market data and alerts fail over to Bybit when Binance is unavailable.',
      'Fixed navigation on tablet widths.',
      'Fixed a Strategy Panel save that could overwrite itself.',
      'Dialogs keep keyboard focus inside them while open.',
    ],
  },
  {
    date: '2026-09-12',
    tag: 'v2026.09.12b',
    items: [
      'Settings stay consistent across devices.',
      'Fixed a false CVD alert on HYPE.',
      'Fixed a group of failures that were happening silently.',
    ],
  },
  {
    date: '2026-09-12',
    tag: 'v2026.09.12',
    items: [
      'Settings are no longer lost when a save fails.',
      'A clear message when your plan status cannot be read, instead of a guess.',
      'Strategy Panel choices persist.',
      'Liquidation labels on the chart.',
    ],
  },
  {
    date: '2026-09-10',
    tag: 'v2026.09.10',
    items: [
      'AI Arena restored to the approved layout.',
      'Live market data streams over a WebSocket, with Bybit as the primary source.',
    ],
  },
  {
    date: '2026-09-06',
    tag: 'v2026.09.06b',
    items: [
      'The coin health grade has an accessible name, so a screen reader announces it.',
    ],
  },
  {
    date: '2026-09-06',
    tag: 'v2026.09.06',
    items: [
      'The setup-quality tooltip can be reached from the keyboard.',
    ],
  },
  {
    date: '2026-09-05',
    tag: 'v2026.09.05',
    items: [
      'The terminal design became the default on every page.',
    ],
  },
];
