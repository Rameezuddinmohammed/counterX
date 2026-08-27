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
# The "..." suffix builds all workspace packages the target depends on first,
# while skipping the Next.js consoles (merchant/wallet/operations/landing),
# which are deployed to Vercel and would otherwise be built in parallel and
# exhaust memory on the Fly remote builder.
RUN pnpm --filter "./${BUILD_TARGET}..." run build

# Fly.io default port
ENV PORT=8080
EXPOSE 8080

CMD node ${BUILD_TARGET}/dist/main.js
