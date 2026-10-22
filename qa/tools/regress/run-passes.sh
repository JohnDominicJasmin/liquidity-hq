#!/usr/bin/env bash
# #1640 browser passes on qa, one at a time (PM 2026-10-21: one headless Chromium, abort at 1.6 GB free via memguard.mjs, 2-3 min between passes).
# Each pass streams to its own log under _sweep/passes/. A pass that exits 3 (memory abort) is retried once after 3 minutes; a second abort is
# recorded and the runner moves on. usage: bash run-passes.sh [names csv=all]   names: crud auth embed wording buttons reruns econ scan
cd "$(dirname "$0")" || exit 1
ROOT="C:/Users/Dominic/Documents/LiquidityHQ-QA-regression-2026-10-21"
LOGDIR="$ROOT/_sweep/passes"; mkdir -p "$LOGDIR"
SUMMARY="$LOGDIR/summary.log"
WANT="${1:-crud,auth,embed,wording,buttons,reruns,econ,scan}"
export MSYS_NO_PATHCONV=1
declare -A CMD=(
  [crud]="node regress-crud.mjs B,T settings,alerts,journal,language"
  [crudA]="node regress-crud.mjs A alerts,language"
  [auth]="node regress-auth.mjs"
  [embed]="node ../qa-howto-arena/embed-phone.mjs C:/Users/Dominic/Documents/LiquidityHQ-QA-1606-phone/after-1636 390,360,1280"
  [wording]="node regress-i18n.mjs switch,scan ko,zh,ru,ar /arena,/upgrade,/terms,/calc,/journal,/hours,/dashboard"
  [buttons]="node regress-buttons.mjs"
  [reruns]="node regress-pages.mjs A 1280,390 /reset-password,/terms,/refund,/funding"
  [econ]="node ../qa-howto-arena/econ-live.mjs C:/Users/Dominic/Documents/LiquidityHQ-QA-1625-live normal,none,http429"
  [scan]="node regress-i18n.mjs scan ko,zh,ru"
  [trialwording]="env I18N_ACCT=T node regress-i18n.mjs scan ko,zh,ru /dashboard,/arena"
  [onboarding]="node regress-auth.mjs onboarding"
  [landingswitch]="node landing-switch.mjs"
  [wordingcheck]="node wording-check.mjs ko,zh,ru"
  [images]="env RERUN=anon|/|1280,anon|/|390,A|/arena|1280,A|/arena|390,B|/upgrade|1280,B|/upgrade|390 node regress-pages.mjs anon,A,B 1280,390 /,/arena,/upgrade"
)
export RERUN="A|/reset-password|1280,A|/reset-password|390,A|/terms|390,A|/refund|1280,A|/refund|390,A|/funding|1280"
export WAIT=20000
IFS=',' read -ra NAMES <<< "$WANT"
for n in "${NAMES[@]}"; do
  c="${CMD[$n]}"; [ -z "$c" ] && { echo "$(date -u +%T) unknown pass $n" | tee -a "$SUMMARY"; continue; }
  for try in 1 2; do
    echo "$(date -u +%T) START $n (try $try): $c" | tee -a "$SUMMARY"
    $c >> "$LOGDIR/$n.log" 2>&1; rc=$?
    echo "$(date -u +%T) END $n (try $try) exit $rc" | tee -a "$SUMMARY"
    [ $rc -ne 3 ] && break
    [ $try -eq 1 ] && { echo "$(date -u +%T) memory abort: waiting 180 s before one retry" | tee -a "$SUMMARY"; sleep 180; }
  done
  sleep 150
done
echo "$(date -u +%T) ALL DONE" | tee -a "$SUMMARY"
