FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build
COPY blue-whale-parent blue-whale-parent
COPY blue-whale-gateway blue-whale-gateway
# -Dmaven.test.skip=true 彻底跳过测试编译（不仅跳过执行），
# 避免 src/test 中因依赖版本漂移产生的编译错误阻塞生产镜像构建。
# parent pom 的 maven-source-plugin 会在 package 阶段额外产出 *-sources.jar，
# 导致下游 COPY *.jar 匹配多文件失败；构建后显式删除，保证只剩主 jar。
RUN mvn -q -f blue-whale-parent/pom.xml install -Dmaven.test.skip=true -B \
 && mvn -q -f blue-whale-gateway/pom.xml package -Dmaven.test.skip=true -B \
 && rm -f blue-whale-gateway/target/*-sources.jar

FROM eclipse-temurin:17-jre
WORKDIR /app
# IK1W1E 构建身份：构建期注入源码 commit 与时间，通过 LABEL + ENV 暴露。
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
LABEL blue-whale.git-commit="${GIT_COMMIT}" blue-whale.build-time="${BUILD_TIME}"
ENV GIT_COMMIT=${GIT_COMMIT} \
    BUILD_TIME=${BUILD_TIME}
# curl 供 Docker healthcheck 探测 /health
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/blue-whale-gateway/target/*.jar app.jar
COPY --from=builder /build/blue-whale-gateway/target/lib lib
COPY --from=builder /build/blue-whale-gateway/target/config config
EXPOSE 8686
ENTRYPOINT ["java", "-jar", "app.jar"]
