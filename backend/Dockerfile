# blue-whale 主 API 镜像（NestJS Product API，apps/blue-whale）。
#
# tsc -b + tsc-alias → node dist（node worker 已退役，镜像只跑主 API）。
# 环境变量（DATABASE_URL/REDIS_*/JWT_SECRET/NEW_API_*/VOLC_* 等）全部由火山流水线
# docker run 注入，镜像零密钥。
#
# 构建（context = 仓库根）：
#   docker build -f backend/Dockerfile -t blue-whale-api:latest .

FROM node:24-alpine
RUN corepack enable
WORKDIR /app

# workspace 根 + backend package.json（pnpm install 解析 workspace:*；contracts/core 已并入 backend/libs）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY backend/tsconfig.json backend/
# IKHJ0Q：pnpm-workspace.yaml 的 patchedDependencies 指向这里的补丁，必须在 pnpm install 之前到位，
# 否则 --frozen-lockfile 解析补丁路径时 ENOENT。容器内路径须与 pnpm-workspace.yaml 里
# backend/patches/... 一致；该子树已由 .dockerignore 的 !backend/** 放行，无需单独开白名单。
COPY backend/patches backend/patches

# 国内 npm 镜像加速
ENV npm_config_registry=https://registry.npmmirror.com
ENV pnpm_config_registry=https://registry.npmmirror.com
RUN pnpm install --frozen-lockfile --filter "@blue-whale/backend..."

# 源码 + tsconfig
COPY tsconfig.json tsconfig.base.json ./
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
COPY backend backend

# 跨进程契约（ADR-0113 决策 8）：生成物**不入仓**（.gitignore「跨进程契约生成物」），
# 只能在构建时生成——backend/libs 里 billing-client 等直接 import ../../contracts/gen/**，
# 缺了它 tsc -b 直接 TS2307，整个后端镜像构建失败（2026-09-28 流水线首现）。
# buf 版本与本地开发对齐（brew buf 1.73.0），保证「同一份 .proto 两端产出一致」。
COPY contracts contracts
RUN npm i -g @bufbuild/buf@1.73.0 && cd contracts && buf generate

# Prisma client + backend 全量构建（含主 API app）
RUN pnpm --filter @blue-whale/backend exec prisma generate
RUN pnpm --dir backend build

WORKDIR /app/backend
# 主 API 默认 3100，PORT 可覆盖（docker run -e PORT=...）
EXPOSE 3100
# alpine 无 curl，用 node 内置 fetch 探活 /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/blue-whale/src/main.js"]