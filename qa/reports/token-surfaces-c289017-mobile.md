
## dark theme — observed landing surfaces

Measured on https://liquidity-hq-qa.onrender.com at mobile, 30 routes. Each row is a
background this token was actually rendered against, not a background it
could be. Threshold is the strictest that applies to text seen on it.


### `--green` `#3fb950` — **1 of 25 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#1e4e3e (composited)` | 3.73:1 | 4.5 | **FAIL** | /scanner | `span` ARB |
| `#1b3f34 (composited)` | 4.59:1 | 4.5 | pass | /scanner | `span` ENA |
| `#182e28 (composited)` | 5.68:1 | 4.5 | pass | /funding, /scanner | `span` STX |
| `#182c27 (composited)` | 5.80:1 | 4.5 | pass | /funding | `span` Long |
| `#152b26 (composited)` | 5.89:1 | 4.5 | pass | /liq | `gex-net-chip` +$17.08B net |
| `#172824 (composited)` | 6.05:1 | 4.5 | pass | /funding, /scanner | `span` ↑ 36 |
| `#172623 (composited)` | 6.18:1 | 4.5 | pass | /funding | `span` Shorts Crowded |
| `#1c2421 (composited)` | 6.23:1 | 4.5 | pass | /funding | `span` Shorts Dominant |
| `#162220 (composited)` | 6.42:1 | 4.5 | pass | /scanner | `span` WIF |
| `#17221c (composited)` | 6.44:1 | 4.5 | pass | /playbook | `cat-badge` Timing |
| `#18211e (composited)` | 6.48:1 | 4.5 | pass | /scanner | `scan-badge` Open Int ↑↑ |
| `#15211b (composited)` | 6.53:1 | 4.5 | pass | /dashboard, /hours | `csb2-chg` ▲ 0.00% |
| `#131f1e (composited)` | 6.63:1 | 4.5 | pass | /liq | `liq-section-sub` ↑ Short squeeze zones |
| `#151b1b (composited)` | 6.88:1 | 4.5 | pass | /scanner | `span` TRX |
| `#171a1c (composited)` | 6.91:1 | 4.5 | pass | /liq | `liq-row-lev` 20x ◆ |
| `#0b1b18 (composited)` | 6.96:1 | 4.5 | pass | /scanner | `scan-badge` Open Int ↑↑ |
| `#14191a (composited)` | 6.97:1 | 4.5 | pass | /scanner | `span` ↑ |
| `--bdr3 #16191b` | 6.97:1 | 4.5 | pass | /dashboard | `csb2-sig` Tight consolidation |
| `#121717 (composited)` | 7.15:1 | 4.5 | pass | /scanner | `span` ↑ |
| `--bg1 #141517` | 7.19:1 | 4.5 | pass | /dashboard, /funding, /liq +2 | `fng-score` 69 |
| `--bg2 #111416` | 7.28:1 | 4.5 | pass | /briefing, /correlation, /liq | `gex-value` +$217M |
| `#121315 (composited)` | 7.31:1 | 4.5 | pass | /briefing | `span` RSI 6 |
| `#150d10 (composited)` | 7.53:1 | 4.5 | pass | /scanner | `scan-stat-val` -0.2540% |
| `#06070a (composited)` | 7.93:1 | 4.5 | pass | /markets, /scanner | `mkt-mono` +11.63% |
| `#000000 (composited)` | 8.27:1 | 4.5 | pass | /markets | `span` ▲ 10 bullish |

### `--red` `#f0524d` — **4 of 29 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#392728 (composited)` | 4.04:1 | 4.5 | **FAIL** | /econ-calendar | `span` high |
| `#362325 (composited)` | 4.23:1 | 4.5 | **FAIL** | /scanner | `span` HYPE |
| `#342224 (composited)` | 4.30:1 | 4.5 | **FAIL** | /econ-calendar | `span` high |
| `#2f2022 (composited)` | 4.45:1 | 4.5 | **FAIL** | /briefing, /funding | `span` Short ↓ |
| `#2b1e20 (composited)` | 4.59:1 | 4.5 | pass | /funding, /scanner | `span` ↓ 14 |
| `#241b1d (composited)` | 4.80:1 | 4.5 | pass | /scanner | `span` XRP |
| `#2b171a (composited)` | 4.84:1 | 4.5 | pass | /scanner | `scan-badge` Open Int ↓↓ |
| `#261a1b (composited)` | 4.84:1 | 4.5 | pass | /playbook | `cat-badge` Trap |
| `#121d2b (composited)` | 4.86:1 | 4.5 | pass | /liq | `liq-current-chg` ▼1.25% |
| `#2a1719 (composited)` | 4.87:1 | 4.5 | pass | /markets | `div` D |
| `#23191a (composited)` | 4.91:1 | 4.5 | pass | /dashboard, /hours, /reset-password | `csb2-chg` ▼ 1.24% |
| `#1f1a1b (composited)` | 4.94:1 | 4.5 | pass | /liq | `liq-section-sub` ↓ Long liquidation zones |
| `#151b1b (composited)` | 5.01:1 | 4.5 | pass | /scanner | `span` 67 |
| `#171a1c (composited)` | 5.03:1 | 4.5 | pass | /liq | `liq-row-lev` 20x ◆ |
| `#1b181a (composited)` | 5.06:1 | 4.5 | pass | /scanner | `span` FIL |
| `--bdr3 #16191b` | 5.08:1 | 4.5 | pass | /dashboard | `csb2-sig` Tight consolidation |
| `#291013 (composited)` | 5.11:1 | 4.5 | pass | /markets | `div` F |
| `#1a1718 (composited)` | 5.12:1 | 4.5 | pass | /scanner | `span` ↓ |
| `#191617 (composited)` | 5.17:1 | 4.5 | pass | /scanner | `span` ↓ |
| `#1e1214 (composited)` | 5.23:1 | 4.5 | pass | /research, /scanner | `scan-badge` RSI 85 |
| `--bg1 #141517` | 5.24:1 | 4.5 | pass | /briefing, /calc, /dashboard +4 | `div` ▼ 1.24% |
| `#171416 (composited)` | 5.25:1 | 4.5 | pass | /scanner | `span` ↓ |
| `--bg2 #111416` | 5.30:1 | 4.5 | pass | /briefing, /correlation, /liq | `liq-row-lev` ↑ BTC headwind |
| `#121315 (composited)` | 5.32:1 | 4.5 | pass | /briefing, /liq, /research | `span` OI ↓↓ |
| `#170e11 (composited)` | 5.42:1 | 4.5 | pass | /scanner | `strong` SEI |
| `#150d10 (composited)` | 5.48:1 | 4.5 | pass | /scanner | `scan-dir-label` Long liquidation risk ↓ |
| `#0a0b0e (composited)` | 5.64:1 | 4.5 | pass | /liq | `liq-bias-badge` Long-heavy |
| `#06070a (composited)` | 5.77:1 | 4.5 | pass | /markets, /research, /scanner | `mkt-mono` -1.22% |
| `#000000 (composited)` | 6.02:1 | 4.5 | pass | /markets | `span` ▼ 13 bearish |

### `--txt3` `#7c828a` — **2 of 12 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#121d2b (composited)` | 4.38:1 | 4.5 | **FAIL** | /liq | `liq-current-oi` $4.2B Open Interest |
| `#1a1b1d (composited)` | 4.46:1 | 4.5 | **FAIL** | /econ-calendar | `div` in 2d 18h |
| `#191a1c (composited)` | 4.51:1 | 4.5 | pass | /scanner | `span` ⓘ |
| `#171a1c (composited)` | 4.53:1 | 4.5 | pass | /liq | `liq-row-dist` $81,457 |
| `--bg1 #141517` | 4.71:1 | 4.5 | pass | /briefing, /calc, /dashboard +10 | `a` ⓘ |
| `--bg2 #111416` | 4.77:1 | 4.5 | pass | /about, /alerts, /briefing +11 | `abbr` Order wall |
| `#15120c (composited)` | 4.82:1 | 4.5 | pass | /briefing, /journal, /research +1 | `button` × |
| `#0f1113 (composited)` | 4.87:1 | 4.5 | pass | /dashboard | `span` F |
| `#150d10 (composited)` | 4.93:1 | 4.5 | pass | /scanner | `scan-rank` #1 |
| `#0f0c03 (composited)` | 5.05:1 | 4.5 | pass | /upgrade | `a` Back to Arena |
| `#06070a (composited)` | 5.20:1 | 4.5 | pass | /about, /briefing, /calc +18 | `a` ▼ +43 more coins |
| `#000000 (composited)` | 5.42:1 | 4.5 | pass | /markets, /upgrade | `a` ← Back |

### `--txt2` `#8b8f94` — all 11 pass

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#202123 (composited)` | 4.97:1 | 4.5 | pass | /dashboard | `sotd-static-badge` 📖 Playbook |
| `#1d1e20 (composited)` | 5.11:1 | 4.5 | pass | /funding | `span` Balanced |
| `#1a1b1d (composited)` | 5.32:1 | 4.5 | pass | /econ-calendar | `div` 0.1% |
| `#191a1c (composited)` | 5.37:1 | 4.5 | pass | /scanner | `span` Coin |
| `#1b181a (composited)` | 5.43:1 | 4.5 | pass | /scanner | `span` 60 |
| `--bg1 #141517` | 5.62:1 | 4.5 | pass | /briefing, /calc, /dashboard +7 | `a` $78,365.86 |
| `--bg2 #111416` | 5.68:1 | 4.5 | pass | /about, /alerts, /calc +4 | `cf` No resolved outcomes yet |
| `#111215 (composited)` | 5.77:1 | 4.5 | pass | /scanner | `span` Price flat |
| `#0f1113 (composited)` | 5.80:1 | 4.5 | pass | /dashboard | `span` C |
| `#150d10 (composited)` | 5.88:1 | 4.5 | pass | /scanner | `scan-stat-val` 27% |
| `#06070a (composited)` | 6.19:1 | 4.5 | pass | /forgot-password, /liq, /login +5 | `div` $77,597.54 |

### `--accent` `#d9a626` — all 16 pass

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#20272b (composited)` | 6.83:1 | 4.5 | pass | /liq | `liq-current-tag` LIVE |
| `#152133 (composited)` | 7.27:1 | 4.5 | pass | /calc | `ps-preset` 1.5% |
| `#221f18 (composited)` | 7.38:1 | 4.5 | pass | /briefing, /funding, /playbook +1 | `a` Generate Briefing |
| `#141f2e (composited)` | 7.48:1 | 4.5 | pass | /markets | `div` B |
| `#1f1e17 (composited)` | 7.49:1 | 4.5 | pass | /about, /hours | `pt` LONDON OPEN |
| `#231c0e (composited)` | 7.57:1 | 4.5 | pass | /briefing, /journal, /research +1 | `span` i |
| `--bg1 #141517` | 8.21:1 | 4.5 | pass | /, /about, /alerts +27 | `consent-link` Privacy Policy |
| `#081527 (composited)` | 8.23:1 | 4.5 | pass | /calc | `ps-preset` Position Sizer |
| `--bg2 #111416` | 8.31:1 | 4.5 | pass | /forgot-password, /hours, /liq +3 | `a` $4.2B |
| `#121315 (composited)` | 8.34:1 | 4.5 | pass | /briefing | `span` Vol 1.6x |
| `#15120c (composited)` | 8.39:1 | 4.5 | pass | /briefing, /correlation, /funding +7 | `cf` Morning Briefing |
| `#150d10 (composited)` | 8.59:1 | 4.5 | pass | /scanner | `scan-stat-val` 4.67x |
| `#0f0c03 (composited)` | 8.79:1 | 4.5 | pass | /upgrade | `a` Pro Plan |
| `#06070a (composited)` | 9.05:1 | 4.5 | pass | /alerts, /research, /scanner | `div` 2.27x |
| `#050505 (composited)` | 9.15:1 | 4.5 | pass | /, /learn | `learn-category-title` RISK DISCLOSURE |
| `#000000 (composited)` | 9.43:1 | 4.5 | pass | /upgrade | `div` Upgrade to |

### `--bg0` `#08090a` — all 1 pass

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `--accent #d9a626` | 8.95:1 | 4.5 | pass | /, /about, /alerts +27 | `consent-btn` Accept |

### `--amber` `#fbbf24` — all 9 pass

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#262318 (composited)` | 9.44:1 | 4.5 | pass | /playbook | `cat-badge` Psychology |
| `#242217 (composited)` | 9.59:1 | 4.5 | pass | /hours | `window-pill` GOD TIER |
| `#242118 (composited)` | 9.64:1 | 4.5 | pass | /funding | `span` Longs Dominant |
| `#221f18 (composited)` | 9.84:1 | 4.5 | pass | /briefing | `span` WARNING |
| `#1a1b1d (composited)` | 10.37:1 | 4.5 | pass | /econ-calendar | `div` 0.3% |
| `--bg1 #141517` | 10.95:1 | 4.5 | pass | /briefing, /dashboard, /econ-calendar +3 | `div` Decent conditions - be s |
| `--bg2 #111416` | 11.08:1 | 4.5 | pass | /briefing, /correlation | `macro-item-chg` 69 |
| `#121315 (composited)` | 11.12:1 | 4.5 | pass | /research | `span` Moderate |
| `#06070a (composited)` | 12.07:1 | 4.5 | pass | /markets, /scanner | `mkt-signal` Short covering |

### `--txt` `#e8e9ea` — all 9 pass

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#2c2c2e (composited)` | 11.43:1 | 4.5 | pass | /scanner | `button` All |
| `#1a1b1d (composited)` | 14.23:1 | 4.5 | pass | /econ-calendar | `div` Average Hourly Earnings  |
| `--bg1 #141517` | 15.03:1 | 4.5 | pass | /, /about, /alerts +27 | `[object` Decline |
| `--bg2 #111416` | 15.21:1 | 4.5 | pass | /about, /briefing, /calc +4 | `csb2-name` Tight |
| `#15120c (composited)` | 15.37:1 | 4.5 | pass | /about, /alerts, /arena +22 | `span` Ask AI |
| `#150d10 (composited)` | 15.73:1 | 4.5 | pass | /scanner | `scan-coin-name` SEI |
| `#0f0c03 (composited)` | 16.11:1 | 4.5 | pass | /upgrade | `div` Pro payments launching s |
| `#06070a (composited)` | 16.57:1 | 4.5 | pass | /about, /alerts, /arena +19 | `div` Loading… |
| `#000000 (composited)` | 17.27:1 | 4.5 | pass | /markets, /upgrade | `div` Markets |

**dark: 7 failing surfaces across 3 tokens, out of 112 observed.**

## light theme — observed landing surfaces

Measured on https://liquidity-hq-qa.onrender.com at mobile, 30 routes. Each row is a
background this token was actually rendered against, not a background it
could be. Threshold is the strictest that applies to text seen on it.


### `--bdr2` `#dfdcd7` — **1 of 1 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `--bg0 #f7f6f3` | 1.27:1 | 4.5 | **FAIL** | /funding | `frh-summary-sep` · |

### `--accent` `#8a5c00` — **9 of 18 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#12233f (composited)` | 2.70:1 | 4.5 | **FAIL** | /arena | `span` LiquidityAI · LIVE X |
| `#d6cab3 (composited)` | 3.59:1 | 4.5 | **FAIL** | /correlation | `corr-cell` - |
| `#d0d0cd (composited)` | 3.75:1 | 4.5 | **FAIL** | /liq | `liq-current-tag` LIVE |
| `#d6d4d1 (composited)` | 3.93:1 | 4.5 | **FAIL** | /briefing | `span` Vol 1.6x |
| `#ddd8ce (composited)` | 4.08:1 | 4.5 | **FAIL** | /about, /hours | `pt` LONDON OPEN |
| `#e4dfd6 (composited)` | 4.39:1 | 4.5 | **FAIL** | /briefing, /funding, /playbook | `cat-badge` Generate Briefing |
| `#e1e0dc (composited)` | 4.41:1 | 4.5 | **FAIL** | /arena, /upgrade | `a` 1h |
| `--bg2 #e3e1dd` | 4.45:1 | 4.5 | **FAIL** | /hours, /liq, /research +1 | `div` All (50) |
| `#e8e1d2 (composited)` | 4.48:1 | 4.5 | **FAIL** | /arena, /briefing, /journal +2 | `span` i |
| `#dce7f4 (composited)` | 4.66:1 | 4.5 | pass | /calc | `ps-preset` Position Sizer |
| `#e0eaf4 (composited)` | 4.77:1 | 4.5 | pass | /markets | `div` B |
| `--bg1 #ebe9e6` | 4.80:1 | 4.5 | pass | /about, /alerts, /arena +25 | `a` Pro Feature |
| `#dfebfb (composited)` | 4.81:1 | 4.5 | pass | /calc | `ps-preset` 1.5% |
| `#e8eaed (composited)` | 4.82:1 | 4.5 | pass | /upgrade | `div` Upgrade to |
| `#efebe2 (composited)` | 4.90:1 | 4.5 | pass | /arena, /briefing, /correlation +8 | `arena-ask-grok-btn` Arena |
| `#f7eeeb (composited)` | 5.09:1 | 4.5 | pass | /scanner | `scan-stat-val` 4.67x |
| `#f7f4ed (composited)` | 5.28:1 | 4.5 | pass | /settings | `a` Create free account |
| `--bg0 #f7f6f3` | 5.39:1 | 4.5 | pass | /alerts, /arena, /research +1 | `div` Sign In → |

### `--amber` `#9a6a00` — **11 of 11 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#cfcdca (composited)` | 2.99:1 | 4.5 | **FAIL** | /dashboard | `span` FUTURES LEADING |
| `#d6d4d1 (composited)` | 3.20:1 | 4.5 | **FAIL** | /research | `span` Moderate |
| `#e0d7ce (composited)` | 3.33:1 | 4.5 | **FAIL** | /hours | `window-pill` GOD TIER |
| `#e7dfd7 (composited)` | 3.58:1 | 4.5 | **FAIL** | /playbook | `cat-badge` Psychology |
| `--bg2 #e3e1dd` | 3.63:1 | 4.5 | **FAIL** | /briefing, /correlation | `macro-item-chg` 69 |
| `#ede5d3 (composited)` | 3.77:1 | 4.5 | **FAIL** | /arena | `span` Conflicting |
| `#ece6d8 (composited)` | 3.81:1 | 4.5 | **FAIL** | /funding | `frh-sig-crowd` Longs Dominant |
| `#ece6da (composited)` | 3.82:1 | 4.5 | **FAIL** | /briefing | `span` WARNING |
| `--bg1 #ebe9e6` | 3.91:1 | 4.5 | **FAIL** | /arena, /briefing, /dashboard +3 | `b` Decent conditions - be s |
| `#ebeae7 (composited)` | 3.93:1 | 4.5 | **FAIL** | /econ-calendar | `div` 0.3% |
| `--bg0 #f7f6f3` | 4.38:1 | 4.5 | **FAIL** | /markets, /scanner | `mkt-signal` Short covering |

### `--red` `#cf222e` — **24 of 29 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#c6c1be (composited)` | 3.00:1 | 4.5 | **FAIL** | /scanner | `span` ↓ |
| `#cfcdc9 (composited)` | 3.37:1 | 4.5 | **FAIL** | /liq | `liq-bias-badge` Long-heavy |
| `#d6d1ce (composited)` | 3.53:1 | 4.5 | **FAIL** | /scanner | `span` ↓ |
| `#d6d4d1 (composited)` | 3.62:1 | 4.5 | **FAIL** | /briefing, /research | `span` OI ↓↓ |
| `#e1d2cf (composited)` | 3.65:1 | 4.5 | **FAIL** | /dashboard, /hours | `csb2-chg` ▼ 1.30% |
| `#d8d6d4 (composited)` | 3.71:1 | 4.5 | **FAIL** | /liq | `span` Whale Long |
| `#d5d8dc (composited)` | 3.76:1 | 4.5 | **FAIL** | /liq | `liq-current-chg` ▼1.19% |
| `#e0dad7 (composited)` | 3.87:1 | 4.5 | **FAIL** | /scanner | `span` ↓ |
| `#edd7d4 (composited)` | 3.90:1 | 4.5 | **FAIL** | /scanner | `span` HYPE |
| `#e4dad7 (composited)` | 3.91:1 | 4.5 | **FAIL** | /liq | `liq-section-sub` ↓ Long liquidation zones |
| `#e9d9d7 (composited)` | 3.92:1 | 4.5 | **FAIL** | /dashboard, /playbook, /reset-password | `cat-badge` ▼ 1.16% |
| `#edd8d6 (composited)` | 3.93:1 | 4.5 | **FAIL** | /econ-calendar | `span` high |
| `#edd9d6 (composited)` | 3.94:1 | 4.5 | **FAIL** | /econ-calendar | `span` high |
| `#eddbd8 (composited)` | 4.00:1 | 4.5 | **FAIL** | /arena, /briefing, /funding | `span` ▼ Bearish |
| `#ecddda (composited)` | 4.06:1 | 4.5 | **FAIL** | /funding, /scanner | `span` ↓ 14 |
| `#f6dbd9 (composited)` | 4.10:1 | 4.5 | **FAIL** | /markets | `div` F |
| `--bg2 #e3e1dd` | 4.10:1 | 4.5 | **FAIL** | /briefing, /correlation, /dashboard +1 | `csb2-sig` New sellers opening |
| `#e4e2de (composited)` | 4.13:1 | 4.5 | **FAIL** | /liq | `liq-row-lev` 20x ◆ |
| `#ece1de (composited)` | 4.17:1 | 4.5 | **FAIL** | /arena, /scanner | `span` ✗ |
| `#ebe5e2 (composited)` | 4.31:1 | 4.5 | **FAIL** | /scanner | `span` FIL |
| `#f7e2df (composited)` | 4.31:1 | 4.5 | **FAIL** | /markets, /scanner | `div` D |
| `#e6e8e4 (composited)` | 4.35:1 | 4.5 | **FAIL** | /scanner | `span` 67 |
| `--bg1 #ebe9e6` | 4.42:1 | 4.5 | **FAIL** | /arena, /briefing, /correlation +6 | `b` ▼ 1.30% |
| `#e8eaed (composited)` | 4.44:1 | 4.5 | **FAIL** | /markets | `span` ▼ 13 bearish |
| `#f7e9e6 (composited)` | 4.53:1 | 4.5 | pass | /arena, /research, /scanner | `scan-badge` ↓ 27 |
| `#f7edea (composited)` | 4.65:1 | 4.5 | pass | /scanner | `strong` XAU |
| `#f7eeeb (composited)` | 4.69:1 | 4.5 | pass | /scanner | `scan-dir-label` Long liquidation risk ↓ |
| `--bg0 #f7f6f3` | 4.96:1 | 4.5 | pass | /funding, /markets, /research +1 | `frh-summary-count` -1.21% |
| `#fafafa (composited)` | 5.13:1 | 4.5 | pass | /calc | `strong` $15.00 |

### `--green` `#14702c` — **7 of 26 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#c1c3bf (composited)` | 3.50:1 | 4.5 | **FAIL** | /scanner | `span` ↑ |
| `#cccbc8 (composited)` | 3.82:1 | 4.5 | **FAIL** | /dashboard | `span` B |
| `#d6d4d1 (composited)` | 4.20:1 | 4.5 | **FAIL** | /briefing | `span` RSI 6 |
| `#d2d8cf (composited)` | 4.28:1 | 4.5 | **FAIL** | /hours | `window-pill` PRIME |
| `#dad8d4 (composited)` | 4.36:1 | 4.5 | **FAIL** | /liq | `gex-value` +$1.22B |
| `#b4e2cf (composited)` | 4.36:1 | 4.5 | **FAIL** | /scanner | `span` ARB |
| `#cedfd5 (composited)` | 4.48:1 | 4.5 | **FAIL** | /liq | `gex-net-chip` +$17.08B net |
| `#daddd8 (composited)` | 4.52:1 | 4.5 | pass | /scanner | `span` ↑ |
| `#c3e4d5 (composited)` | 4.55:1 | 4.5 | pass | /scanner | `span` TIA |
| `#dadfd7 (composited)` | 4.59:1 | 4.5 | pass | /dashboard, /playbook | `cat-badge` ▲ 4.84% |
| `#d9e0d9 (composited)` | 4.62:1 | 4.5 | pass | /liq | `liq-section-sub` ↑ Short squeeze zones |
| `--bg2 #e3e1dd` | 4.75:1 | 4.5 | pass | /briefing, /correlation, /dashboard +1 | `csb2-sig` Tight consolidation |
| `#d3e6dc (composited)` | 4.77:1 | 4.5 | pass | /funding, /scanner | `frh-sig-crowd` NEAR |
| `#e4e2de (composited)` | 4.78:1 | 4.5 | pass | /liq | `liq-row-lev` 20x ◆ |
| `#d5e6dd (composited)` | 4.80:1 | 4.5 | pass | /arena, /funding | `span` ▲ Bullish |
| `#d9e7de (composited)` | 4.85:1 | 4.5 | pass | /funding, /scanner | `span` ↑ 36 |
| `#dbe7df (composited)` | 4.88:1 | 4.5 | pass | /funding | `frh-sig-crowd` Shorts Crowded |
| `#dee7e1 (composited)` | 4.93:1 | 4.5 | pass | /arena, /scanner | `span` ✓ |
| `#e6e8e4 (composited)` | 5.04:1 | 4.5 | pass | /scanner | `span` TRX |
| `#e4e9e2 (composited)` | 5.05:1 | 4.5 | pass | /funding | `frh-sig-crowd` Shorts Dominant |
| `#e4ebe3 (composited)` | 5.12:1 | 4.5 | pass | /scanner | `scan-badge` Open Int ↑↑ |
| `--bg1 #ebe9e6` | 5.12:1 | 4.5 | pass | /arena, /correlation, /dashboard +4 | `corr-pair-val` +0.38% |
| `#e8eaed (composited)` | 5.15:1 | 4.5 | pass | /markets | `span` ▲ 10 bullish |
| `#e4f3ea (composited)` | 5.39:1 | 4.5 | pass | /scanner | `scan-badge` Open Int ↑↑ |
| `#f7eeeb (composited)` | 5.43:1 | 4.5 | pass | /scanner | `scan-stat-val` -0.2536% |
| `--bg0 #f7f6f3` | 5.74:1 | 4.5 | pass | /funding, /markets, /scanner | `frh-summary-count` +12.10% |

### `--txt-dash` `#5e6267` — **25 of 58 surfaces FAIL**

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#99dfc3 (composited)` | 4.01:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.80 |
| `#9adfc4 (composited)` | 4.03:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.80 |
| `#9ce0c5 (composited)` | 4.05:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.79 |
| `#9ee0c6 (composited)` | 4.07:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.79 |
| `#a0e0c6 (composited)` | 4.09:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.78 |
| `#a2e0c7 (composited)` | 4.11:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.77 |
| `#a4e0c8 (composited)` | 4.13:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.77 |
| `#a5e1c9 (composited)` | 4.15:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.76 |
| `#a7e1ca (composited)` | 4.17:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.76 |
| `#a9e1ca (composited)` | 4.19:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.75 |
| `#abe1cb (composited)` | 4.21:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.74 |
| `#ade2cc (composited)` | 4.23:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.74 |
| `#afe2cd (composited)` | 4.25:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.74 |
| `#b0e2cd (composited)` | 4.28:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.73 |
| `#b2e2ce (composited)` | 4.30:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.73 |
| `#d5d8dc (composited)` | 4.31:1 | 4.5 | **FAIL** | /liq | `liq-current-oi` $4.2B Open Interest |
| `#dad8d4 (composited)` | 4.32:1 | 4.5 | **FAIL** | /liq | `span` ← current price |
| `#b4e2cf (composited)` | 4.32:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.71 |
| `#b6e3d0 (composited)` | 4.34:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.71 |
| `#b8e3d0 (composited)` | 4.36:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.70 |
| `#bae3d1 (composited)` | 4.39:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.70 |
| `#bbe3d2 (composited)` | 4.41:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.69 |
| `#bde4d3 (composited)` | 4.43:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.68 |
| `#bfe4d4 (composited)` | 4.46:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.67 |
| `#c1e4d4 (composited)` | 4.48:1 | 4.5 | **FAIL** | /correlation | `corr-cell` 0.67 |
| `#c3e4d5 (composited)` | 4.50:1 | 4.5 | pass | /correlation | `corr-cell` 0.66 |
| `#c5e4d6 (composited)` | 4.53:1 | 4.5 | pass | /correlation | `corr-cell` 0.65 |
| `#c6e5d7 (composited)` | 4.55:1 | 4.5 | pass | /correlation | `corr-cell` 0.64 |
| `#c8e5d7 (composited)` | 4.57:1 | 4.5 | pass | /correlation | `corr-cell` 0.63 |
| `#cae5d8 (composited)` | 4.60:1 | 4.5 | pass | /correlation | `corr-cell` 0.62 |
| `#cce5d9 (composited)` | 4.62:1 | 4.5 | pass | /correlation | `corr-cell` 0.62 |
| `#cee5da (composited)` | 4.65:1 | 4.5 | pass | /correlation | `corr-cell` 0.61 |
| `#e1e0dc (composited)` | 4.66:1 | 4.5 | pass | /upgrade | `a` Back to Arena |
| `#d0e6da (composited)` | 4.67:1 | 4.5 | pass | /correlation | `corr-cell` 0.60 |
| `#d1e6db (composited)` | 4.70:1 | 4.5 | pass | /correlation | `corr-cell` 0.59 |
| `--bg2 #e3e1dd` | 4.70:1 | 4.5 | pass | /about, /alerts, /arena +8 | `abbr` Order wall |
| `#d3e6dc (composited)` | 4.72:1 | 4.5 | pass | /correlation | `corr-cell` 0.58 |
| `#e4e2de (composited)` | 4.74:1 | 4.5 | pass | /liq | `liq-row-dist` $81,581 |
| `#d5e6dd (composited)` | 4.75:1 | 4.5 | pass | /correlation | `corr-cell` 0.57 |
| `#d7e7de (composited)` | 4.77:1 | 4.5 | pass | /correlation | `corr-cell` 0.55 |
| `#d9e7de (composited)` | 4.80:1 | 4.5 | pass | /correlation | `corr-cell` 0.54 |
| `#dbe7df (composited)` | 4.83:1 | 4.5 | pass | /correlation | `corr-cell` 0.52 |
| `#dce7e0 (composited)` | 4.85:1 | 4.5 | pass | /correlation | `corr-cell` 0.51 |
| `#dee7e1 (composited)` | 4.88:1 | 4.5 | pass | /correlation | `corr-cell` 0.48 |
| `#e0e8e1 (composited)` | 4.91:1 | 4.5 | pass | /correlation | `corr-cell` 0.47 |
| `#e2e8e2 (composited)` | 4.93:1 | 4.5 | pass | /correlation | `corr-cell` 0.43 |
| `#e4e8e3 (composited)` | 4.96:1 | 4.5 | pass | /correlation | `corr-cell` 0.40 |
| `--bg1 #ebe9e6` | 5.07:1 | 4.5 | pass | /arena, /briefing, /correlation +13 | `a` ⓘ |
| `#ebe9e7 (composited)` | 5.09:1 | 4.5 | pass | /scanner | `span` ⓘ |
| `#ebeae7 (composited)` | 5.09:1 | 4.5 | pass | /econ-calendar | `div` in 2d 18h |
| `#e8eaed (composited)` | 5.10:1 | 4.5 | pass | /markets, /upgrade | `a` ← Back |
| `#efebe2 (composited)` | 5.17:1 | 4.5 | pass | /arena, /briefing, /journal +2 | `button` × |
| `#f7eeeb (composited)` | 5.38:1 | 4.5 | pass | /scanner | `scan-rank` #1 |
| `#f5f2ec (composited)` | 5.50:1 | 4.5 | pass | /correlation | `span` avg BTC-alt: 0.65 |
| `#f5f5f5 (composited)` | 5.63:1 | 4.5 | pass | /calc | `ps-affix` $ |
| `--bg0 #f7f6f3` | 5.68:1 | 4.5 | pass | /about, /arena, /briefing +19 | `a` ▼ +43 more coins |
| `#fafafa (composited)` | 5.88:1 | 4.5 | pass | /calc, /liq | `ps-card-lbl` ⓘ |
| `#ffffff (composited)` | 6.14:1 | 4.5 | pass | /settings | `div` Off |

### `--txt2` `#585c61` — all 22 pass

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#e4dfd6 (composited)` | 5.08:1 | 4.5 | pass | /funding | `td` +0.0016% |
| `#e5e0d8 (composited)` | 5.14:1 | 4.5 | pass | /funding | `frh-sig-crowd` Balanced |
| `--bg2 #e3e1dd` | 5.16:1 | 4.5 | pass | /about, /alerts, /calc +3 | `cf` No resolved outcomes yet |
| `#d3e6dc (composited)` | 5.18:1 | 4.5 | pass | /funding | `frh-sig-hint` → Size up longs |
| `#e3e2e0 (composited)` | 5.20:1 | 4.5 | pass | /arena | `span` ⏸ FREEZE |
| `#ece1de (composited)` | 5.24:1 | 4.5 | pass | /arena | `span` Trend Signal (fast/slow  |
| `#ece2d8 (composited)` | 5.28:1 | 4.5 | pass | /funding | `frh-sig-hint` → Reduce longs |
| `#dbe7df (composited)` | 5.29:1 | 4.5 | pass | /funding | `frh-sig-hint` → Buy dips |
| `#dee7e1 (composited)` | 5.35:1 | 4.5 | pass | /arena | `span` 200 SMA Filter (Daily) |
| `#eae6e0 (composited)` | 5.41:1 | 4.5 | pass | /funding | `frh-sig-hint` → No clear edge |
| `#ece6d8 (composited)` | 5.42:1 | 4.5 | pass | /funding | `frh-sig-hint` → Trade carefully |
| `#ebe5e2 (composited)` | 5.42:1 | 4.5 | pass | /scanner | `span` 60 |
| `#e4e9e2 (composited)` | 5.48:1 | 4.5 | pass | /funding | `frh-sig-hint` → Watch for squeeze |
| `--bg1 #ebe9e6` | 5.56:1 | 4.5 | pass | /arena, /briefing, /calc +7 | `b` $78,365.86 |
| `#ebe9e7 (composited)` | 5.58:1 | 4.5 | pass | /arena, /scanner | `span` - |
| `#ebeae7 (composited)` | 5.58:1 | 4.5 | pass | /econ-calendar | `div` 0.1% |
| `#eceae7 (composited)` | 5.61:1 | 4.5 | pass | /dashboard, /funding | `frh-sig-crowd` 📖 Playbook |
| `#f7eeeb (composited)` | 5.90:1 | 4.5 | pass | /scanner | `scan-stat-val` 31% |
| `--bg0 #f7f6f3` | 6.25:1 | 4.5 | pass | /arena, /forgot-password, /funding +7 | `div` ▼ |
| `#f7f6f4 (composited)` | 6.25:1 | 4.5 | pass | /scanner | `span` Price flat |
| `#fafafa (composited)` | 6.45:1 | 4.5 | pass | /calc, /liq | `ps-lbl` ↑ |
| `#ffffff (composited)` | 6.73:1 | 4.5 | pass | /settings | `a` Appearance |

### `--txt` `#15181b` — all 34 pass

| landing surface | contrast | needs | | seen on | example |
|---|---|---|---|---|---|
| `#6fdab2 (composited)` | 10.47:1 | 4.5 | pass | /correlation | `corr-cell` 0.90 |
| `#70dab2 (composited)` | 10.52:1 | 4.5 | pass | /correlation | `corr-cell` 0.90 |
| `#72dab3 (composited)` | 10.56:1 | 4.5 | pass | /correlation | `corr-cell` 0.89 |
| `#74dbb4 (composited)` | 10.61:1 | 4.5 | pass | /correlation | `corr-cell` 0.89 |
| `#76dbb5 (composited)` | 10.66:1 | 4.5 | pass | /correlation | `corr-cell` 0.88 |
| `#7adbb6 (composited)` | 10.75:1 | 4.5 | pass | /correlation | `corr-cell` 0.88 |
| `#7bdcb7 (composited)` | 10.80:1 | 4.5 | pass | /correlation | `corr-cell` 0.87 |
| `#7ddcb8 (composited)` | 10.85:1 | 4.5 | pass | /correlation | `corr-cell` 0.87 |
| `#7fdcb9 (composited)` | 10.90:1 | 4.5 | pass | /correlation | `corr-cell` 0.87 |
| `#81dcb9 (composited)` | 10.95:1 | 4.5 | pass | /correlation | `corr-cell` 0.86 |
| `#83dcba (composited)` | 10.99:1 | 4.5 | pass | /correlation | `corr-cell` 0.85 |
| `#85ddbb (composited)` | 11.04:1 | 4.5 | pass | /correlation | `corr-cell` 0.85 |
| `#86ddbc (composited)` | 11.10:1 | 4.5 | pass | /correlation | `corr-cell` 0.85 |
| `#88ddbc (composited)` | 11.15:1 | 4.5 | pass | /correlation | `corr-cell` 0.84 |
| `#8addbd (composited)` | 11.20:1 | 4.5 | pass | /correlation | `corr-cell` 0.84 |
| `#8cdebe (composited)` | 11.25:1 | 4.5 | pass | /correlation | `corr-cell` 0.83 |
| `#8edebf (composited)` | 11.30:1 | 4.5 | pass | /correlation | `corr-cell` 0.83 |
| `#90dec0 (composited)` | 11.36:1 | 4.5 | pass | /correlation | `corr-cell` 0.82 |
| `#91dec0 (composited)` | 11.41:1 | 4.5 | pass | /correlation | `corr-cell` 0.82 |
| `#93dec1 (composited)` | 11.46:1 | 4.5 | pass | /correlation | `corr-cell` 0.82 |
| `#95dfc2 (composited)` | 11.52:1 | 4.5 | pass | /correlation | `corr-cell` 0.81 |
| `#97dfc3 (composited)` | 11.57:1 | 4.5 | pass | /correlation | `corr-cell` 0.80 |
| `#99dfc3 (composited)` | 11.63:1 | 4.5 | pass | /correlation | `corr-cell` 0.80 |
| `#d5d8dc (composited)` | 12.51:1 | 4.5 | pass | /liq | `liq-current-price` $77,696 |
| `#e1e0dc (composited)` | 13.51:1 | 4.5 | pass | /upgrade | `div` Pro payments launching s |
| `--bg2 #e3e1dd` | 13.65:1 | 4.5 | pass | /about, /briefing, /correlation +3 | `csb2-name` Tight |
| `--bg1 #ebe9e6` | 14.71:1 | 4.5 | pass | /about, /alerts, /arena +25 | `[object` Best Setup Today |
| `#ebeae7 (composited)` | 14.78:1 | 4.5 | pass | /econ-calendar | `div` Average Hourly Earnings  |
| `#e8eaed (composited)` | 14.79:1 | 4.5 | pass | /markets, /upgrade | `div` Markets |
| `#edebe9 (composited)` | 15.00:1 | 4.5 | pass | /scanner | `button` All |
| `#f7eeeb (composited)` | 15.61:1 | 4.5 | pass | /scanner | `scan-coin-name` XAU |
| `--bg0 #f7f6f3` | 16.49:1 | 4.5 | pass | /about, /alerts, /arena +19 | `div` LiquidityAI Arena |
| `#fafafa (composited)` | 17.07:1 | 4.5 | pass | /liq | `sr-only` Watching for trades > $5 |
| `#ffffff (composited)` | 17.82:1 | 4.5 | pass | /calc | `ps-coin-trigger-label` Any coin (enter prices m |

**light: 77 failing surfaces across 6 tokens, out of 199 observed.**
