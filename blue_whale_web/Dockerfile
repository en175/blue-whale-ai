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
# --filter ... 匹配包名 @blue-whale/web（不是目录名 blue_whale_web），安装其依赖链。
# IK7ERQ：额外带上两个 worker —— builder 阶段要跑 apps 的单元测试，只装 @blue-whale/web 链
# 时 apps/*/node_modules 无 workspace 软链，vitest 报 Failed to load url @blue-whale/*。
# 两者依赖全在 @blue-whale/web 已有的链内（contracts/core/persistence/agent-runtime/
# generation-runtime），不引入任何额外外部下载；runner 阶段只 COPY standalone，镜像不变大。
RUN pnpm install --frozen-lockfile \
    --filter "@blue-whale/web..." \
    --filter "@blue-whale/agent-worker..." \
    --filter "@blue-whale/generation-worker..."

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
# IK774I（修 IK747Z lint 配套遗漏）：pnpm lint:node = eslint apps packages，
# builder 阶段需仓库根 eslint.config.mjs 与 apps 源码在场，否则 ESLint 9 找不到 flat config 直接 exit 2。
COPY eslint.config.mjs ./
COPY apps apps
# IK7ERQ：跨端契约的 schema 与夹具（约 104K）。lib/creative-skill-activation-contract.test.ts
# 从 docs/specs/fixtures 读 manifest，再按 manifest.schema 回溯读 docs/specs/*.json 校验
# wire shape；缺任一侧该用例 ENOENT。.dockerignore 已对应放行（散文 .md 不进上下文）。
COPY docs/specs/fixtures docs/specs/fixtures
COPY docs/specs/*.json docs/specs/

# 先编译 workspace 包（Next.js 通过 exports 字段引用 dist/ 输出）
# IK72WL：agent-runtime 缺失导致 next build 报 Can't resolve '@blue-whale/agent-runtime'
RUN pnpm --filter @blue-whale/contracts --filter @blue-whale/core --filter @blue-whale/agent-runtime --filter @blue-whale/persistence --filter @blue-whale/generation-runtime build
# IK747Z-1：lint 硬性拦截（全仓：packages/apps + web；max-lines 800 error 级）——超限构建失败
RUN pnpm lint
# IK7ERQ：单元测试硬性拦截——用例失败即构建失败，坏行为进不了镜像。
# 用 test:ci 而非 test：后者的 test:node 含 acceptance-runner-contract，
# 依赖 tests/ 与 scripts/，二者不在构建上下文内（见根 package.json 注释同源约定）。
# 放在 next build 之前，让最便宜的失败最早发生。
RUN pnpm --dir packages/persistence exec prisma generate \
    && pnpm test:ci
# 构建 Next.js standalone
# IK7TED：@volcengine/openapi 的完整运行时文件（含 tls.proto）由 next.config.ts 的
# outputFileTracingIncludes 强制纳入 NFT trace，随 standalone 产出。此前 IK75CR 在此
# npm install 补 SDK 副本，但运行期 require 解析命中的是 .next 内 NFT 副本而非该补装
# 副本（本地 standalone 实测），hack 从未生效且版本硬编码，故移除。
RUN pnpm --filter @blue-whale/web build

# IK7TED 硬门禁：standalone 必须含 tls.proto。NFT 不追踪 protobuf.load 的动态路径，
# 靠 next.config.ts 的 outputFileTracingIncludes glob 强制纳入——glob 依赖 pnpm 的
# .pnpm 目录命名（@scope+name@version_peer 后缀），pnpm 布局变更时需校准该 glob。
# 缺文件 = 回到 IK7TED 前的静默零上报，故构建期 ls 失败即阻断。
RUN ls blue_whale_web/.next/standalone/node_modules/.pnpm/@volcengine+openapi@*/node_modules/@volcengine/openapi/lib/services/tls/tls.proto

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
