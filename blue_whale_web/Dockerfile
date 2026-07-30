# Next.js standalone 构建（见 next.config.ts output: "standalone"）
# 多阶段：deps（pnpm monorepo）→ builder（编译 workspace 包 + next build）→ runner（最小运行镜像）
#
# GATEWAY_URL 是运行时 env（next.config.ts 的 rewrites() 在 standalone server.js 启动时读取 process.env），
# 不在构建期固化，便于同一镜像切换后端环境。

FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app

# Workspace 根文件
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# workspace 包的 package.json（pnpm install 需要解析 workspace:* 依赖）
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/generation-runtime/package.json packages/generation-runtime/
COPY packages/persistence/package.json packages/persistence/
# 非依赖链但 pnpm workspaces 必需——缺文件 filter 匹配失败，"No projects matched the filters"
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY apps/agent-worker/package.json apps/agent-worker/
COPY apps/generation-worker/package.json apps/generation-worker/
# 目标应用
COPY blue_whale_web/package.json blue_whale_web/
COPY blue_whale_web/patches blue_whale_web/patches

# 阿里云 npm 镜像加速（ENV 覆盖 lockfile 中已解析的 registry.npmjs.org URL）
ENV npm_config_registry=https://registry.npmmirror.com
# --filter ... 只安装 blue_whale_web 及其依赖链，避免触及 apps/* 等无关包
RUN pnpm install --frozen-lockfile --filter blue_whale_web...

FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY --from=deps /app ./
# TypeScript 配置
COPY tsconfig.json tsconfig.base.json ./
# workspace 包源码
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/generation-runtime packages/generation-runtime
COPY packages/persistence packages/persistence
# 目标应用源码
COPY blue_whale_web blue_whale_web

# 构建期给一个占位让 rewrite 函数能编译；运行时由 ENV GATEWAY_URL 覆盖真实地址
ENV NEXT_PUBLIC_SKIP_AUTH=1
ENV GATEWAY_URL=http://blue-whale-gateway:8686

# 先编译 workspace 包（Next.js 通过 exports 字段引用 dist/ 输出）
RUN pnpm --filter @blue-whale/contracts --filter @blue-whale/core --filter @blue-whale/persistence --filter @blue-whale/generation-runtime build
# 构建 Next.js standalone
RUN pnpm --filter blue_whale build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# IK2BCH 构建身份：构建期注入源码 commit 与时间，通过 LABEL + ENV 暴露，
# 供 docker inspect 与 /build-info 端点核对运行制品版本（照搬 agent-service IK1W1E 范式）。
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
LABEL blue-whale.git-commit="${GIT_COMMIT}" blue-whale.build-time="${BUILD_TIME}"
ENV GIT_COMMIT=${GIT_COMMIT} \
    BUILD_TIME=${BUILD_TIME}

# standalone 模式只产出最小依赖 + server.js
COPY --from=builder /app/blue_whale_web/.next/standalone ./
COPY --from=builder /app/blue_whale_web/.next/static ./blue_whale_web/.next/static
COPY --from=builder /app/blue_whale_web/.worker-dist ./blue_whale_web/.worker-dist

EXPOSE 3000
# 容器内 server.js 默认监听 3000；通过 HOSTNAME=0.0.0.0 暴露到 LAN
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
CMD ["node", "blue_whale_web/server.js"]
