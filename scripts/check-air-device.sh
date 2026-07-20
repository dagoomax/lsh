#!/bin/bash
# check-air-device.sh — verify a Loxone Air battery device is still reporting.
#
# There is no way to "wake" a Loxone Air device over the network (see
# wiki/Loxone-Integration.md) — it's an RF device paired directly to the
# Miniserver, and LSH only ever sees whatever the Miniserver forwards. This
# script instead polls LSH's history for the device's sensor key and flags
# it if nothing has arrived in too long, so a dead battery / dropped pairing
# gets noticed instead of silently going stale.
#
# Setup:
#   1. Find the device's key in LSH: Settings → API / or GET /api/devices
#      (Loxone devices are keyed "loxone/<control-uuid>"), and the sensor
#      path from that device's `sensors` list (e.g. "temp", "value").
#   2. Fill in DEVICES below as "Label|loxone/<uuid>/<sensorPath>" — one per
#      monitored device.
#   3. Put an LSH API token in LSH_TOKEN (Settings → API tokens) or export it
#      in the environment before running.
#   4. Install the weekly cron job (adjust the path):
#        crontab -e
#        0 8 * * 1  LSH_TOKEN=xxxxx /Users/gumax/victron/scripts/check-air-device.sh >> /Users/gumax/victron/logs/air-check.log 2>&1
#
set -euo pipefail

LSH_URL="${LSH_URL:-http://localhost:3001}"
LSH_TOKEN="${LSH_TOKEN:?Set LSH_TOKEN to an LSH API token (Settings → API tokens)}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-8}"   # a bit over the 7-day check interval, to absorb jitter

# One "Label|history-key" per monitored device.
DEVICES=(
  "Garden sensor|loxone/0f7b3a12-34ab-cdef-ffff-1234567890ab/temp"
)

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq   >/dev/null || { echo "jq is required (brew install jq)"   >&2; exit 1; }

now=$(date +%s)
status=0

for entry in "${DEVICES[@]}"; do
  label="${entry%%|*}"
  key="${entry#*|}"

  response=$(curl -fsS --max-time 10 \
    -H "Authorization: Bearer ${LSH_TOKEN}" \
    "${LSH_URL}/api/history/${key}") || {
    echo "[$(date -u +%FT%TZ)] ERROR  ${label} (${key}): request to LSH failed"
    status=1
    continue
  }

  last_ms=$(echo "$response" | jq -r '.points[-1][0] // empty')
  if [ -z "$last_ms" ]; then
    echo "[$(date -u +%FT%TZ)] WARNING ${label} (${key}): no history at all — never reported, or key is wrong"
    status=1
    continue
  fi

  age_days=$(( (now - last_ms / 1000) / 86400 ))
  if [ "$age_days" -gt "$MAX_AGE_DAYS" ]; then
    echo "[$(date -u +%FT%TZ)] WARNING ${label} (${key}): last report ${age_days}d ago (limit ${MAX_AGE_DAYS}d) — check battery / Air pairing"
    status=1
  else
    echo "[$(date -u +%FT%TZ)] OK      ${label} (${key}): last report ${age_days}d ago"
  fi
done

exit $status
