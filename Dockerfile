## Shared multi-stage Dockerfile for all Node.js packages.
## Build-arg PACKAGE selects which package to run.
##
## Usage:
##   docker build --build-arg PACKAGE=token-launcher -t token-launcher .
##   docker build --build-arg PACKAGE=exit-manager    -t exit-manager .

ARG NODE_VERSION=20

# --- Stage 1: install dependencies ---
FROM node:${NODE_VERSION}-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config + lockfile first (layer caching)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy all package.json files (needed for pnpm install --frozen-lockfile)
COPY packages/shared/package.json          packages/shared/package.json
COPY packages/token-launcher/package.json  packages/token-launcher/package.json
COPY packages/exit-manager/package.json    packages/exit-manager/package.json
COPY packages/trend-detector/package.json  packages/trend-detector/package.json
COPY packages/telegram-bot/package.json    packages/telegram-bot/package.json
COPY packages/dashboard/package.json      packages/dashboard/package.json

RUN pnpm install --frozen-lockfile

# --- Stage 2: copy source and run ---
FROM node:${NODE_VERSION}-alpine AS runner

ARG PACKAGE

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules         ./node_modules
COPY --from=deps /app/packages/shared/node_modules         packages/shared/node_modules/
COPY --from=deps /app/packages/${PACKAGE}/node_modules     packages/${PACKAGE}/node_modules/

# Copy workspace root files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./

# Copy shared package (all services depend on it)
COPY packages/shared/ packages/shared/

# Copy the target package source
COPY packages/${PACKAGE}/ packages/${PACKAGE}/

# Copy drizzle migrations (needed by shared/db/migrate.ts)
COPY drizzle/ drizzle/

# Persist PACKAGE as an env var so CMD can reference it at runtime
ENV NODE_ENV=production
ENV PACKAGE=${PACKAGE}
CMD pnpm -C packages/${PACKAGE} start
