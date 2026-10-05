# syntax = docker/dockerfile:1

# The kitchen app. Whatever it is built with, the image must serve HTTP on
# 0.0.0.0:$PORT (fly.toml sets PORT) and publish README.md at /readme/
# (spec/README.md says what's checked). Node runs the .ts files directly, so
# there is no build step; SQLite is node's own, so nothing native to compile.

FROM docker.io/library/node:24.21.0-alpine
WORKDIR /app

# Only production dependencies go in the image: marked, for the README page.
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src/ src/
COPY README.md ./

# /data is the Fly volume: the only storage that survives a restart or redeploy.
ENV DATA_DIR=/data
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
