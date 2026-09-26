# blue-whale-billing Dockerfile
# 多阶段构建：docker build 一步出镜像，无需外部先跑 mvn。
#   阶段1 build   —— maven:3.9+temurin21，按 pom 预热依赖层（pom 不变即缓存命中），再编译打包
#   阶段2 runtime —— eclipse-temurin:21-jre
# 契约测试不进镜像构建（保持快且免环境依赖）：收口处跑 `mvn -B test` / PR 门禁。
#
# ⚠️ **构建上下文是 `server/`（不是 `server/blue-whale-billing/`）** —— billing 依赖 `server/blue-whale-common`，
#    而 Docker 不能 COPY 上下文之外的文件，所以上下文要抬到聚合根。
#    与 worker 同一约定（见 server/blue-whale-worker/Dockerfile 的同款说明）。
#    本地自验：docker build -f server/blue-whale-billing/Dockerfile server/
#
# ⚠️ 本文件是**骨架**：镜像能出、能起、/ready 可用；DB / MQ / catalog 接入后按需补 RUN 层。

# ---------- 阶段1：Maven 构建 ----------
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /build

# 依赖层先行：仅 pom 不变时此层走缓存，不重复下载。
COPY pom.xml ./
COPY blue-whale-common/pom.xml blue-whale-common/
COPY blue-whale-worker/pom.xml blue-whale-worker/
COPY blue-whale-billing/pom.xml blue-whale-billing/
COPY docker-settings.xml ./
# -pl blue-whale-billing -am：只构建 billing 及其模块内依赖（blue-whale-common），不构建无关模块
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-billing -am dependency:go-offline

COPY blue-whale-common/src blue-whale-common/src
COPY blue-whale-billing/src blue-whale-billing/src
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-billing -am -DskipTests package

# ---------- 阶段2：运行时 ----------
FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# 通配符不匹配 spring-boot repackage 的 .jar.original，只会命中可执行 fat-jar
COPY --from=build /build/blue-whale-billing/target/blue-whale-billing-*.jar app.jar

ENV BILLING_PORT=4003

EXPOSE 4003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4003/ready || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
