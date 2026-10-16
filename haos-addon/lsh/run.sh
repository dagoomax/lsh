#!/bin/sh
# LSH's own code resolves config.json and persist/ relative to its install
# directory (/app) — it has no env var for an alternate data path. Supervisor
# only gives apps one persistent, backed-up directory (/data), so this
# symlinks the paths LSH expects onto it. First run seeds an *empty*
# config.json, not a copy of config.example.json: the example is a reference
# doc with every integration's fields already filled in (placeholder hosts
# like "192.168.1.x"), which satisfies the exact truthy checks server.js uses
# to decide whether to start a client — copying it verbatim would auto-start
# every documented integration against a fake host. config.js defaults every
# section to '' / [] / undefined when absent, so `{}` is a safe empty state;
# the user fills in real integrations through LSH's own Settings UI. Deliberately
# POSIX sh, not bash — the base image doesn't carry bash and there's no need
# to add it for four lines.
set -e

# which LSH this image was built from — the first line of the add-on log, so
# after Update / Rebuild it's clear whether the new code really arrived
echo "LSH add-on $(cat /app/.lsh-build 2>/dev/null || echo '(unknown build)')"

mkdir -p /data/persist /data/certs
[ -f /data/config.json ] || echo '{}' > /data/config.json

rm -rf /app/config.json /app/config.json.bak /app/automations.json /app/persist /app/certs
ln -s /data/config.json /app/config.json
# flows, rules and scenes (src/automation-engine.js) live beside config.json —
# outside /data they'd be gone at every add-on restart; LSH creates the file
# on the first save, written through the link
ln -s /data/automations.json /app/automations.json
# config.js falls back to config.json.bak when config.json is broken; LSH
# writes the backup next to the real file (/data), so link it too
ln -s /data/config.json.bak /app/config.json.bak
ln -s /data/persist     /app/persist
ln -s /data/certs       /app/certs

exec node server.js
