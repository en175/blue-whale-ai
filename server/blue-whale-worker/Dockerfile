# blue-whale-worker Dockerfile（火山 pipeline）
# 多阶段构建：docker build 一步出镜像，无需外部先跑 mvn。
#   阶段1 build   —— maven:3.9+temurin21，按 pom 预热依赖层（pom 不变即缓存命中），再编译打包
#   阶段2 runtime —— eclipse-temurin:21-jre + ffmpeg（FfmpegExtractor 运行时依赖）
# 契约测试不进镜像构建（保持快且免环境依赖）：收口处跑 `mvn -B test` / PR 门禁。
#
# ⚠️ **构建上下文必须是 `server/`（不是 `server/blue-whale-worker/`）** —— ADR-0114 后 worker 依赖
#    `server/blue-whale-common`，而 Docker 不能 COPY 上下文之外的文件，所以上下文要抬到聚合根。
#    流水线的「Dockerfile 路径」= `server/blue-whale-worker/Dockerfile`，「构建上下文」= `server/`。
#    本地自验：docker build -f server/blue-whale-worker/Dockerfile server/

# ---------- 阶段1：Maven 构建 ----------
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /build

# 依赖层先行：仅 pom 不变时此层走缓存，不重复下载。
# docker-settings.xml 把依赖源指到阿里云公共仓（境内直连 central 实测 15+ 分钟未完）。
#
# ⚠️ 必须 COPY **全部** module 的 pom——**包括本次不构建的 blue-whale-billing**：
#    Maven 读聚合 pom 时会逐个解析 <module>，缺任何一个的 pom 都会直接
#    `Child module /build/blue-whale-billing does not exist` 构建失败。
#    （实测踩到：漏 COPY billing/pom.xml → dependency:go-offline exit 1）
COPY pom.xml ./
COPY blue-whale-common/pom.xml blue-whale-common/
COPY blue-whale-worker/pom.xml blue-whale-worker/
COPY blue-whale-billing/pom.xml blue-whale-billing/
COPY docker-settings.xml ./
# -pl blue-whale-worker -am：只构建 worker 及其模块内依赖（blue-whale-common），不构建无关模块
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-worker -am dependency:go-offline

COPY blue-whale-common/src blue-whale-common/src
COPY blue-whale-worker/src blue-whale-worker/src
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-worker -am -DskipTests package

# ---------- 阶段2：运行时 ----------
FROM eclipse-temurin:21-jre

# ffmpeg 安装（apt：debian-based temurin 镜像）
# FfmpegExtractor 缺省 FFMPEG_PATH=ffmpeg，走 PATH 查找
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# 通配符不匹配 spring-boot repackage 的 .jar.original，只会命中可执行 fat-jar
# 注意路径多了一层 worker/：聚合构建后产物在 /build/blue-whale-worker/target/
COPY --from=build /build/blue-whale-worker/target/blue-whale-worker-*.jar app.jar

ENV GENERATION_WORKER_PORT=4002

EXPOSE 4002

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4002/ready || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
