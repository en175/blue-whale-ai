# worker-java Dockerfile（火山 pipeline）
# 多阶段构建：docker build 一步出镜像，无需外部先跑 mvn。
#   阶段1 build   —— maven:3.9+temurin21，按 pom 预热依赖层（pom 不变即缓存命中），再编译打包
#   阶段2 runtime —— eclipse-temurin:21-jre + ffmpeg（FfmpegExtractor 运行时依赖）
# 契约测试不进镜像构建（保持快且免环境依赖）：收口处跑 `mvn -B test` / PR 门禁。

# ---------- 阶段1：Maven 构建 ----------
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /build

# 依赖层先行：仅 pom/settings 不变时此层走缓存，不重复下载
# docker-settings.xml 把依赖源指到阿里云公共仓（境内直连 central 实测 15+ 分钟未完）
COPY pom.xml docker-settings.xml ./
RUN mvn -B -q -s docker-settings.xml dependency:go-offline

COPY src ./src
RUN mvn -B -q -s docker-settings.xml -DskipTests package

# ---------- 阶段2：运行时 ----------
FROM eclipse-temurin:21-jre

# ffmpeg 安装（apt：debian-based temurin 镜像）
# FfmpegExtractor 缺省 FFMPEG_PATH=ffmpeg，走 PATH 查找
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# 通配符不匹配 spring-boot repackage 的 .jar.original，只会命中可执行 fat-jar
COPY --from=build /build/target/worker-java-*.jar app.jar

# 灰度开关（空 = 不消费，安全拉起 /ready）
ENV WORKER_ENABLED_TAGS=""
ENV GENERATION_WORKER_PORT=4002

EXPOSE 4002

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4002/ready || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
