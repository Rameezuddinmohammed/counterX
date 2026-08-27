# Shared multi-app Dockerfile for Fly.io deployment
# Usage: docker build --build-arg BUILD_TARGET=apps/control-plane-api -t my-app .

FROM node:22-alpine

# Install pnpm globally
RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Accept build arg to determine which app to build and run.
# BUILD_TARGET is a workspace path, e.g. apps/control-plane-api.
ARG BUILD_TARGET
ENV BUILD_TARGET=${BUILD_TARGET}

# Copy the entire monorepo
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build only the target backend app and its workspace dependency closure.
# Resolve the target's package NAME from its package.json and use the name
# filter with the "..." suffix so pnpm selects the app plus every workspace
# package it depends on. Each of those packages now builds via `tsc -b`
# (project references), so the dependency closure compiles in correct
# topological order regardless of pnpm's parallel scheduling. This skips the
# Next.js consoles (landing/merchant/operations/wallet), which deploy to Vercel
# and would otherwise be built in parallel and exhaust memory on the Fly
# remote builder.
RUN pnpm --filter "$(node -p "require('./${BUILD_TARGET}/package.json').name")..." run build

# Fly.io default port
ENV PORT=8080
EXPOSE 8080

CMD node ${BUILD_TARGET}/dist/main.js
