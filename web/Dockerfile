# blue_whale_web 前端镜像（Vite + React，SPA）。
#
# 多阶段：
#   builder：node 24 + npm ci → vite build --mode release → dist/
#   runtime：nginx:alpine 托管静态 + 反代 /api/ → $BACKEND_UPSTREAM
#
# 反代目标由运行时环境变量 BACKEND_UPSTREAM 注入（火山流水线 docker run -e），
# 利用官方 nginx 镜像 /etc/nginx/templates/ 内置 envsubst 机制渲染；
# NGINX_ENVSUBST_FILTER 限定只替换 BACKEND_UPSTREAM，避免误伤配置里的
# $uri/$host 等 nginx 内置变量。
#
# 构建（context = 仓库根，与 backend 镜像一致）：
#   docker build -f web/Dockerfile -t blue-whale-web:latest .
#
# 火山流水线必须把 contextPath 设为仓库根（空或 .），Dockerfile 仍用 web/Dockerfile。
# 画布/会话源码相对引用 packages/contracts 与 packages/core，context=web/ 会编不过。

FROM node:24-alpine AS builder
WORKDIR /src
ENV npm_config_registry=https://registry.npmmirror.com

COPY web/package.json web/package-lock.json ./web/
WORKDIR /src/web
RUN npm ci

WORKDIR /src
# contracts 源码依赖 zod；装到仓库根 node_modules，tsc 从 packages/contracts 上溯即可解析。
RUN npm install zod@4.4.3 --no-package-lock --omit=dev
# packages/*/tsconfig.json extends ../../tsconfig.base.json；Vite 编这些文件时要读到仓库根这份。
COPY tsconfig.base.json tsconfig.json ./
COPY packages/contracts ./packages/contracts
COPY packages/core ./packages/core
COPY web ./web

WORKDIR /src/web
RUN npm run build:release

FROM nginx:alpine AS runtime
COPY --from=builder /src/web/dist /usr/share/nginx/html
COPY web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
# 默认反代目标；火山流水线 docker run -e BACKEND_UPSTREAM=... 覆盖
ENV BACKEND_UPSTREAM=http://backend:3100
ENV NGINX_ENVSUBST_FILTER=BACKEND_UPSTREAM
EXPOSE 80
