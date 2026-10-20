
FROM node:24-alpine
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && \
    apk add --no-cache tzdata
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY backend/tsconfig.json backend/
COPY backend/patches backend/patches

ENV TZ=Asia/Shanghai
ENV npm_config_registry=https://registry.npmmirror.com
ENV pnpm_config_registry=https://registry.npmmirror.com
RUN pnpm install --frozen-lockfile --filter "@blue-whale/backend..."

COPY tsconfig.json tsconfig.base.json ./
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
COPY backend backend

COPY contracts contracts
RUN npm i -g @bufbuild/buf@1.73.0 && cd contracts && buf generate

RUN pnpm --filter @blue-whale/backend exec prisma generate
RUN pnpm --dir backend build

WORKDIR /app/backend
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/blue-whale/src/main.js"]