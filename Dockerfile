# ─────────────────────────────────────────────────────────────
# LSH Server — multi-stage build
#   builder : compiles native deps (node-tradfri-client → node-aead-crypto)
#   runtime : slim image with ffmpeg (optional RTSP proxy) + tini
# ─────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime ──────────────────────────────────────────────────
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies from the builder, then the app source (react
# dashboard is served from its prebuilt react-dashboard/dist).
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# HTTP 3000 · HTTPS 3443 · HomeKit 47128 · RTSP 8554
# (HomeKit mDNS needs host networking — see docker-compose.yml)
EXPOSE 3000 3443 47128 8554

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/status',r=>process.exit(0)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
