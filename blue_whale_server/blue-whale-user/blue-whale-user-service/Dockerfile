FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY blue-whale-parent blue-whale-parent
COPY blue-whale-user blue-whale-user
RUN mvn -q -f blue-whale-parent/pom.xml install -DskipTests -B \
 && mvn -q -f blue-whale-user/blue-whale-user-api/pom.xml install -DskipTests -B \
 && mvn -q -f blue-whale-user/blue-whale-user-service/pom.xml package -DskipTests -B

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=builder /build/blue-whale-user/blue-whale-user-service/target/*.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]
