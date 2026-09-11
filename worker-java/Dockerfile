# worker-java Dockerfile（火山 pipeline）
# eclipse-temurin:21-jre + ffmpeg（FfmpegExtractor 运行时依赖）
FROM eclipse-temurin:21-jre

# ffmpeg 安装（apt：debian-based temurin 镜像）
# FfmpegExtractor 缺省 FFMPEG_PATH=ffmpeg，走 PATH 查找
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY target/worker-java-0.0.1-SNAPSHOT.jar app.jar

# 灰度开关（空 = 不消费，安全拉起 /ready）
ENV WORKER_ENABLED_TAGS=""
ENV GENERATION_WORKER_PORT=4002

EXPOSE 4002

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4002/ready || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
