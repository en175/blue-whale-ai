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
# 构建（context = web/）：
#   docker build -f Dockerfile -t blue-whale-web:latest .

FROM node:24-alpine AS builder
WORKDIR /app
ENV npm_config_registry=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:release

FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# 默认反代目标；火山流水线 docker run -e BACKEND_UPSTREAM=... 覆盖
ENV BACKEND_UPSTREAM=http://backend:3100
ENV NGINX_ENVSUBST_FILTER=BACKEND_UPSTREAM
EXPOSE 80