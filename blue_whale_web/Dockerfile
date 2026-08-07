# Next.js standalone 构建（见 next.config.ts output: "standalone"）
# 多阶段：deps（pnpm monorepo）→ builder（编译 workspace 包 + next build）→ runner（最小运行镜像）

FROM node:24-alpine AS deps
# corepack 下载 pnpm 本体也走阿里云镜像（默认走 npmjs.org 海外源）
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
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

# 阿里云 npm 镜像加速。pnpm 11 breaking change：不再读 npm_config_* 环境变量，
# 只认 pnpm_config_* 前缀（pnpm.io/blog/releases/11.0），旧前缀会被静默忽略、直连 npmjs
ENV pnpm_config_registry=https://registry.npmmirror.com
# --filter ... 匹配包名 blue_whale（不是目录名 blue_whale_web），安装其依赖链
RUN pnpm install --frozen-lockfile --filter blue_whale...

FROM node:24-alpine AS builder
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app

# 阿里云 npm 镜像加速（与 deps 阶段一致；pnpm 11 只认 pnpm_config_* 前缀）
ENV pnpm_config_registry=https://registry.npmmirror.com

COPY --from=deps /app ./
# TypeScript 配置
COPY tsconfig.json tsconfig.base.json ./
# workspace 包源码
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY packages/agent-runtime packages/agent-runtime
COPY packages/generation-runtime packages/generation-runtime
COPY packages/persistence packages/persistence
# 目标应用源码
COPY blue_whale_web blue_whale_web

# 先编译 workspace 包（Next.js 通过 exports 字段引用 dist/ 输出）
# IK72WL：agent-runtime 缺失导致 next build 报 Can't resolve '@blue-whale/agent-runtime'
RUN pnpm --filter @blue-whale/contracts --filter @blue-whale/core --filter @blue-whale/agent-runtime --filter @blue-whale/persistence --filter @blue-whale/generation-runtime build
# IK747Z-1：lint 硬性拦截（全仓：packages/apps + web；max-lines 800 error 级）——超限构建失败
RUN pnpm lint
# 构建 Next.js standalone
RUN pnpm --filter blue_whale build

# IK75CR：standalone 不含 serverExternalPackages 的包。@volcengine/openapi 的 TLS
# Producer 需运行时读 tls.proto（不能被打包，否则 ENOENT 上报失效）。pnpm 是符号链接
# 结构无法直接 COPY，用 npm 装真实文件后合并进 standalone/node_modules 供运行时 require。
# 版本须与 pnpm-lock.yaml 中 @volcengine/openapi 一致。
RUN mkdir -p /tmp/tls-sdk && cd /tmp/tls-sdk && \
    echo '{"name":"tls-sdk","version":"1.0.0"}' > package.json && \
    npm install @volcengine/openapi@1.36.2 --registry=https://registry.npmmirror.com --no-audit --no-fund --loglevel=error && \
    cp -a /tmp/tls-sdk/node_modules/. /app/blue_whale_web/.next/standalone/node_modules/

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
# standalone 不自动带入 public/（logo/favicon 等静态资源），须手动 COPY
COPY --from=builder /app/blue_whale_web/public ./blue_whale_web/public

EXPOSE 3000
# 容器内 server.js 默认监听 3000；通过 HOSTNAME=0.0.0.0 暴露到 LAN
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
CMD ["node", "blue_whale_web/server.js"]
