# Shared multi-app Dockerfile for Fly.io deployment
# Usage: docker build --build-arg BUILD_TARGET=apps/control-plane-api -t my-app .

FROM node:22-alpine

# Install pnpm globally
RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Copy the entire monorepo
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all packages and apps
RUN pnpm build

# Accept build arg to determine which app to run
ARG BUILD_TARGET
ENV BUILD_TARGET=${BUILD_TARGET}

# Fly.io default port
ENV PORT=8080
EXPOSE 8080

CMD node ${BUILD_TARGET}/dist/main.js
