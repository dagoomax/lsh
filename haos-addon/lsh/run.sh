#!/bin/sh
# LSH's own code resolves config.json and persist/ relative to its install
# directory (/app) — it has no env var for an alternate data path. Supervisor
# only gives apps one persistent, backed-up directory (/data), so this
# symlinks the paths LSH expects onto it, seeding config.json from the
# example on first run. Deliberately POSIX sh, not bash — the base image
# doesn't carry bash and there's no need to add it for four lines.
set -e

mkdir -p /data/persist /data/certs
[ -f /data/config.json ] || cp /app/config.example.json /data/config.json

rm -rf /app/config.json /app/persist /app/certs
ln -s /data/config.json /app/config.json
ln -s /data/persist     /app/persist
ln -s /data/certs       /app/certs

exec node server.js
