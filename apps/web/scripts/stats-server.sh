#!/usr/bin/env bash
# Prints Quo's figures (scripts/stats.ts) from the server's database, over SSH: costs of the free tier, paid use, sales,
# how much of Pro's allowance is used, trials and accounts. `bash scripts/stats-server.sh [days]` (default 30).
set -euo pipefail
host=${QUO_SERVER:-quo-server}
days=${1:-30}
[[ $days =~ ^[0-9]+$ ]] || { echo "Give the number of days, for example 30." >&2; exit 1; }
ssh "$host" "cd C:\\quo\\app; node --env-file=C:\\quo\\config\\quo.env --import tsx scripts/stats.ts $days"
