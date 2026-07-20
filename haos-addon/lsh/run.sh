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

mkdir -p /data/persist /data/certs
[ -f /data/config.json ] || echo '{}' > /data/config.json

rm -rf /app/config.json /app/persist /app/certs
ln -s /data/config.json /app/config.json
ln -s /data/persist     /app/persist
ln -s /data/certs       /app/certs

exec node server.js
