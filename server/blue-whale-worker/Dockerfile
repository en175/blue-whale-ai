
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /build/server

COPY server/pom.xml ./
COPY server/blue-whale-common/pom.xml blue-whale-common/
COPY server/blue-whale-worker/pom.xml blue-whale-worker/
COPY server/blue-whale-billing/pom.xml blue-whale-billing/
COPY server/docker-settings.xml ./
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-worker -am dependency:go-offline

COPY contracts/proto /build/contracts/proto

COPY server/blue-whale-common/src blue-whale-common/src
COPY server/blue-whale-worker/src blue-whale-worker/src
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-worker -am -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /build/server/blue-whale-worker/target/blue-whale-worker-*.jar app.jar

ENV TZ=Asia/Shanghai
ENV GENERATION_WORKER_PORT=4002

EXPOSE 4002

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4002/ready || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
