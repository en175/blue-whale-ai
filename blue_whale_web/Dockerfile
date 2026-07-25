# Next.js standalone 构建（见 next.config.ts output: "standalone"）
# 多阶段：deps（缓存 node_modules）→ builder（产出 .next/standalone）→ runner（最小运行镜像）
#
# GATEWAY_URL 是运行时 env（next.config.ts 的 rewrites() 在 standalone server.js 启动时读取 process.env），
# 不在构建期固化，便于同一镜像切换后端环境。

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY patches ./patches
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期给一个占位让 rewrite 函数能编译；运行时由 ENV GATEWAY_URL 覆盖真实地址
ENV GATEWAY_URL=http://blue-whale-gateway:8686
RUN npm run build

FROM node:20-alpine AS runner
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
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
# 容器内 server.js 默认监听 3000；通过 HOSTNAME=0.0.0.0 暴露到 LAN
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
CMD ["node", "server.js"]
