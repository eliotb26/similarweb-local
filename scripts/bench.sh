#!/usr/bin/env bash
# Runs the analysis on a fixed set of sites and writes runs.csv.
# Usage: scripts/bench.sh [--headed]
set -euo pipefail
cd "$(dirname "$0")/.."
SITES=(similarweb.com semrush.com ahrefs.com stripe.com notion.com linear.app)
echo "domain,mode,seconds,blocked,tranco_rank,crux_bucket,vendors,ad_vendors,requests,third_party_domains,mb_total,mb_js,load_s" > runs.csv
for mode in headless headed; do
  flag=""; [[ $mode == headed ]] && flag="--headed"
  for d in "${SITES[@]}"; do
    start=$(date +%s.%N 2>/dev/null || python3 -c 'import time;print(time.time())')
    json=$(node src/cli.ts "$d" --json $flag)
    end=$(python3 -c 'import time;print(time.time())')
    secs=$(python3 -c "print(round($end-$start,1))")
    echo "$json" | jq -r --arg m "$mode" --arg s "$secs" '[.domain,$m,$s,.protection.blocked,.popularity.trancoRank,(.popularity.crux[-1].bucket),(.vendors|length),([.vendors[]|select(.category=="ads")]|length),.weight.requests,.weight.thirdPartyHosts,((.weight.totalBytes/1048576*10|round)/10),((.weight.scriptBytes/1048576*10|round)/10),((.weight.loadMs/100|round)/10)]|@csv' >> runs.csv
    echo "$d $mode ${secs}s" >&2
  done
done
