
FROM node:24-alpine AS builder
WORKDIR /src
ENV npm_config_registry=https://registry.npmmirror.com

COPY web/package.json web/package-lock.json ./web/
WORKDIR /src/web
RUN npm ci

WORKDIR /src
RUN npm install zod@4.4.3 --no-package-lock --omit=dev
COPY tsconfig.base.json tsconfig.json ./
COPY backend/libs/contracts ./backend/libs/contracts
COPY backend/libs/core ./backend/libs/core
COPY backend/tsconfig.json ./backend/
COPY web ./web

WORKDIR /src/web
RUN npm run build:release

FROM nginx:alpine AS runtime
COPY --from=builder /src/web/dist /usr/share/nginx/html
COPY web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
ENV BACKEND_UPSTREAM=http://backend:3100
ENV NGINX_ENVSUBST_FILTER=BACKEND_UPSTREAM
EXPOSE 80
