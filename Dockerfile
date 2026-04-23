# Production image for Railway.
#
# Why Docker instead of Railway's default Nixpacks/Railpack flow?
#  - We need a recent FFmpeg (7.x) available on PATH at runtime for server-side
#    video encoding. Railway's pinned Nix package index was not reliably
#    resolving `ffmpeg_7-full` / `ffmpeg-full`, and `aptPkgs` in nixpacks.toml
#    kept getting silently cached out. Pinning the install to an explicit
#    Dockerfile eliminates that entire class of "it works on my laptop" issues.
#
# The multi-stage build keeps the final image slim: we build with dev deps,
# then copy only the production output into a smaller runtime image that
# still has ffmpeg.

# -------- Stage 1: build --------
FROM node:22-slim AS builder

WORKDIR /app

# Build tools for any native npm packages (e.g. bufferutil).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies so the runtime image stays lean.
RUN npm prune --omit=dev

# -------- Stage 2: runtime --------
FROM node:22-slim

WORKDIR /app

# FFmpeg 7 is required for VP9+Alpha (transparent) encoding. Debian's apt
# only ships ffmpeg 5.x/6.x, both of which have known bugs producing
# all-opaque output for VP9 alpha. We pull BtbN's static build of the
# latest ffmpeg 7 instead, which is a single self-contained binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl xz-utils ca-certificates \
    && curl -fsSL -o /tmp/ffmpeg.tar.xz https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
    && mkdir -p /tmp/ffmpeg \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1 \
    && mv /tmp/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg \
    && mv /tmp/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe \
    && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && rm -rf /tmp/ffmpeg /tmp/ffmpeg.tar.xz \
    && apt-get purge -y curl xz-utils \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version | head -n 1

ENV NODE_ENV=production
ENV PORT=3000

# Copy only what the server needs to run.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3000

# Note: `drizzle-kit push` is intentionally NOT run at container start.
# The schema is already applied to Supabase. Running a migration on every
# startup is slow, easy to break on transient DB issues, and was responsible
# for the `ENOENT: /app/dist/table.sql` error observed when connect-pg-simple
# was bundled into dist/ by esbuild.
CMD ["node", "dist/index.cjs"]
