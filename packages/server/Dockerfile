FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/client/ packages/client/
COPY packages/server/ packages/server/

RUN pnpm build:shared && pnpm build:client && pnpm build:server

RUN mkdir -p packages/server/public && cp -r packages/client/dist/* packages/server/public/
RUN pnpm --filter @timedata/server deploy --legacy --prod /prod

FROM node:22-alpine

RUN apk add --no-cache su-exec \
 && addgroup -g 1000 timedata \
 && adduser -u 1000 -G timedata -s /bin/sh -D timedata \
 && mkdir -p /app/data \
 && chown -R timedata:timedata /app

WORKDIR /app
COPY --from=builder /prod ./

RUN apk add --no-cache --virtual .native-build-deps python3 make g++ \
 && npm rebuild better-sqlite3 --build-from-source \
 && test -f node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
 && apk del .native-build-deps

ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production

COPY packages/server/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
