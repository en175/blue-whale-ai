
FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /build/server

COPY server/pom.xml ./
COPY server/blue-whale-common/pom.xml blue-whale-common/
COPY server/blue-whale-worker/pom.xml blue-whale-worker/
COPY server/blue-whale-billing/pom.xml blue-whale-billing/
COPY server/docker-settings.xml ./
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-billing -am dependency:go-offline

COPY contracts/proto /build/contracts/proto

COPY server/blue-whale-common/src blue-whale-common/src
COPY server/blue-whale-billing/src blue-whale-billing/src
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-billing -am -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /build/server/blue-whale-billing/target/blue-whale-billing-*.jar app.jar

ENV TZ=Asia/Shanghai
ENV BILLING_PORT=4003

EXPOSE 4003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4003/ready || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
