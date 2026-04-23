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
#
# VP9+alpha note (April 2026):
#   Previously this Dockerfile used BtbN's static ffmpeg 7 build, under the
#   hypothesis that Debian's apt-shipped ffmpeg was too old to encode VP9+
#   alpha. That static build produced WebM files where the alpha plane was
#   silently dropped despite correct -pix_fmt yuva420p flags — diagnosed
#   down to the libvpx library that BtbN bundles.
#
#   Switching to Debian trixie's apt-packaged ffmpeg (7.1.x + libvpx 1.14.x,
#   both with known-good VP9 alpha support) removes BtbN's libvpx from the
#   equation entirely. If alpha still fails after this change, the cause is
#   upstream of libvpx and we will pivot to a two-stream muxing approach
#   (separate color + alpha VP9 streams, combined via libwebm's sample_muxer).

# -------- Stage 1: build --------
FROM node:22-trixie-slim AS builder

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
FROM node:22-trixie-slim

WORKDIR /app

# FFmpeg 7 from Debian trixie's apt repository. Trixie ships ffmpeg 7.1.x
# with libvpx 1.14.x, which has reliable VP9+alpha encoding support.
#
# We deliberately do NOT use BtbN's static builds here. Earlier revisions
# of this Dockerfile pulled ffmpeg-master-latest from BtbN to get ffmpeg 7,
# but that build's bundled libvpx silently stripped alpha planes from VP9
# WebM output. Debian's libvpx build does not exhibit that bug.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version | head -n 1 \
    && ffmpeg -hide_banner -encoders 2>/dev/null | grep -E "libvpx(-vp9)?" || true

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
