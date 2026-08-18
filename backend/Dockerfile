# blue-whale 主 API 镜像（NestJS Product API，apps/blue-whale）。
#
# 与 backend/Dockerfile.worker 同构构建：tsc -b + tsc-alias → node dist。
# 环境变量（DATABASE_URL/REDIS_*/JWT_SECRET/NEW_API_*/VOLC_* 等）全部由火山流水线
# docker run 注入，镜像零密钥。
#
# 构建（context = 仓库根）：
#   docker build -f backend/Dockerfile -t blue-whale-api:latest .

FROM node:24-alpine
RUN corepack enable
WORKDIR /app

# workspace 根 + 各 package.json（pnpm install 解析 workspace:*）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/generation-runtime/package.json packages/generation-runtime/
COPY packages/persistence/package.json packages/persistence/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY backend/package.json backend/
COPY backend/tsconfig.json backend/

# 国内 npm 镜像加速
ENV npm_config_registry=https://registry.npmmirror.com
ENV pnpm_config_registry=https://registry.npmmirror.com
RUN pnpm install --frozen-lockfile --filter "@blue-whale/backend..."

# 源码 + tsconfig
COPY tsconfig.json tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/generation-runtime packages/generation-runtime
COPY packages/persistence packages/persistence
COPY packages/agent-runtime packages/agent-runtime
COPY backend backend

# Prisma client + backend 全量构建（含主 API app）
RUN pnpm --dir packages/persistence exec prisma generate
RUN pnpm --dir backend build

WORKDIR /app/backend
# 主 API 默认 3100，PORT 可覆盖（docker run -e PORT=...）
EXPOSE 3100
# alpine 无 curl，用 node 内置 fetch 探活 /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/blue-whale/src/main.js"]