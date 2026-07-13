FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY blue-whale-parent blue-whale-parent
COPY blue-whale-gateway blue-whale-gateway
RUN mvn -q -f blue-whale-parent/pom.xml install -DskipTests -B \
 && mvn -q -f blue-whale-gateway/pom.xml package -DskipTests -B

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=builder /build/blue-whale-gateway/target/*.jar app.jar
COPY --from=builder /build/blue-whale-gateway/target/lib lib
COPY --from=builder /build/blue-whale-gateway/target/config config
EXPOSE 8686
ENTRYPOINT ["java", "-jar", "app.jar"]
