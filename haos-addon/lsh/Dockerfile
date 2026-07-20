# Home Assistant app/add-on image for LSH.
#
# Supervisor builds each app using ITS OWN FOLDER as the Docker build
# context — it can't see the rest of this repo (../../src, ../../package.json,
# etc.) even though this Dockerfile lives inside it. So instead of COPYing
# local files like the repo-root Dockerfile does, this one clones LSH's own
# source at build time. LSH_REF pins the branch/tag/commit to build.
#
# This intentionally keeps the same base image and native-module toolchain
# as the repo-root Dockerfile (Debian, not Home Assistant's Alpine base) —
# LSH compiles native deps (node-tradfri-client → node-aead-crypto) via
# node-gyp, and re-deriving that build under musl/apk is a real risk not
# worth taking just to match HA's example base image. The only HA-specific
# requirements are the io.hass.* labels below.
FROM node:20-bookworm-slim

LABEL io.hass.version="1.0.2" \
      io.hass.type="app" \
      io.hass.arch="amd64|aarch64"

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates python3 make g++ ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

ARG LSH_REF=main
WORKDIR /app
RUN git clone --depth 1 --branch "${LSH_REF}" https://github.com/dagoomax/lsh.git . \
    && rm -rf .git

ENV NODE_ENV=production
RUN npm ci --omit=dev

COPY run.sh /run.sh
RUN chmod +x /run.sh

# HTTP 3000 · HTTPS 3443 · HomeKit 47128 · RTSP 8554 — all exposed directly
# via host_network: true in config.yaml (HomeKit mDNS needs it), so no
# `ports:` mapping is declared here.
EXPOSE 3000 3443 47128 8554

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/run.sh"]
