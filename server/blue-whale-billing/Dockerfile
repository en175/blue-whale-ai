# blue-whale-billing Dockerfile
# 多阶段构建：docker build 一步出镜像，无需外部先跑 mvn。
#   阶段1 build   —— maven:3.9+temurin21，按 pom 预热依赖层（pom 不变即缓存命中），再编译打包
#   阶段2 runtime —— eclipse-temurin:21-jre
# 契约测试不进镜像构建（保持快且免环境依赖）：收口处跑 `mvn -B test` / PR 门禁。
#
# ⚠️ **构建上下文是「仓库根」**（不是 server/，也不是 server/blue-whale-billing/）。
#    两个原因，缺一不可：
#      ① billing 依赖 server/blue-whale-common，而 Docker 不能 COPY 上下文之外的文件
#         —— 上下文至少要能同时看见 server/blue-whale-common 与 server/blue-whale-billing；
#      ② 更硬的约束：blue-whale-common 的 protobuf 插件按
#         `${project.basedir}/../../contracts/proto` 取 proto 源（见该模块 pom 的
#         <protoSourceRoot>），而 `contracts/` 在仓库根、与 `server/` 是**兄弟目录**。
#         只把上下文抬到 `server/` 仍然拿不到它。
#    拿不到契约不是「少几个可选类」：billing 主源码里 BillingGrpcService /
#    BillingAdminGrpcService 直接 import com.bluewhale.contracts.*，**主源码编译就炸**
#    （实测：context=server/ 时 `package does not exist`，testCompile 与 compile 两处）。
#    流水线：「Dockerfile 路径」= `server/blue-whale-billing/Dockerfile`，「构建上下文」= **仓库根**。
#    本地自验：docker build -f server/blue-whale-billing/Dockerfile .
#
# ⚠️ 构建树里必须保住「模块的上一级 == 契约的兄弟」这一相对关系：模块落在 /build/server/ 下、
#    契约落在 /build/contracts/ 下，`${basedir}/../../contracts/proto` 才解析得到。见下方 WORKDIR。

# ---------- 阶段1：Maven 构建 ----------
FROM maven:3.9-eclipse-temurin-21 AS build

# ⚠️ 不是 /build：模块必须落在 server/ 这一层，
#    才能让 ${basedir}/../../contracts/proto 指到 /build/contracts/proto。
WORKDIR /build/server

# 依赖层先行：仅 pom 不变时此层走缓存，不重复下载。
# ⚠️ 必须 COPY **全部** module 的 pom——**包括本次不构建的 blue-whale-worker**：
#    Maven 读聚合 pom 时会逐个解析 <module>，缺任何一个的 pom 都会直接
#    `Child module /build/server/blue-whale-worker does not exist` 构建失败。
COPY server/pom.xml ./
COPY server/blue-whale-common/pom.xml blue-whale-common/
COPY server/blue-whale-worker/pom.xml blue-whale-worker/
COPY server/blue-whale-billing/pom.xml blue-whale-billing/
COPY server/docker-settings.xml ./
# -pl blue-whale-billing -am：只构建 billing 及其模块内依赖（blue-whale-common），不构建无关模块
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-billing -am dependency:go-offline

# 契约 proto 源：语言中立的唯一权威在仓库根 contracts/proto（TS 侧 buf 也从这里生成），
# protobuf-maven-plugin 从中生成 com.bluewhale.contracts.*；生成物不进仓，构建期产出。
COPY contracts/proto /build/contracts/proto

COPY server/blue-whale-common/src blue-whale-common/src
COPY server/blue-whale-billing/src blue-whale-billing/src
# ⚠️ 是 `-Dmaven.test.skip=true` 而**不是** `-DskipTests`：后者只跳过「运行」测试、
#    **测试源码照样编译**，而契约类是否可用取决于上面那条 COPY contracts/proto 有没有生效
#    —— 漏了它时 common 的 GeneratedContractsSmokeTest 会在 testCompile 先炸（实测踩到）。
#    用 skip 而非 skipTests：镜像构建不需要测试源码，少编译一遍更快也更少耦合。
RUN mvn -B -q -s docker-settings.xml -pl blue-whale-billing -am -Dmaven.test.skip=true package

# ---------- 阶段2：运行时 ----------
FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# 通配符不匹配 spring-boot repackage 的 .jar.original，只会命中可执行 fat-jar
# 路径里的 server/ 对应阶段1的 WORKDIR /build/server
COPY --from=build /build/server/blue-whale-billing/target/blue-whale-billing-*.jar app.jar

ENV BILLING_PORT=4003

EXPOSE 4003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4003/ready || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
