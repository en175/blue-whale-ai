# ADR 0020: blue_whale_api (new-api) 部署 skill —— 本地交叉编译 + 远程 alpine 镜像

- 状态：Accepted（2026-07-20）
- 决策者：lixq + Claude（grill-with-docs 会话）

## 背景

blue_whale_api（new-api，Go AI 网关）需部署到测试服务器 `115.190.244.91`，与 blue_whale_server（Java 微服务）同机共存。已有 deploy-blue-whale skill 处理 Java jar 部署，但 Go 技术栈不同（单静态二进制 vs jar+JVM、`go:embed` 前端 vs Next standalone）。

## 决策

套用 deploy-blue-whale 流程骨架（本地 build → scp → 远程 docker build → restart），Go 技术栈适配：

1. **本地交叉编译静态二进制**：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`。服务器 x86_64；CGO=0 纯静态兼容 alpine musl，避开本地 docker 与 CGO 交叉工具链。前提：new-api 纯 Go（MySQL/Redis 驱动无 CGO）。
2. **前端 bun build + classic 占位**：default 主题（React 19 Rsbuild）正常构建；classic（date-fns-tz/date-fns 不兼容）失败，写占位 `index.html` 撑 `go:embed` 编译。默认 default 主题，classic 占位不影响运行。
3. **远程 alpine 镜像 + mirror fallback**：`alpine:3.20` 由国内 mirror（daocloud/1ms/dockerproxy/dockerhub）逐个 fallback `pull`+`tag`，绕开 docker.io 墙；`apk` 走 aliyun 源。**不动 docker daemon、不影响同机测试容器**（mysql8/redis/blue-whale-*）——优于配 daemon.json + restart docker（后者会重启所有测试容器）。
4. **端口 3001**：避 blue_whale_web 3000 撞车（同机共存硬约束）。
5. **公网 IP 回连**：new-api 容器经 `115.190.244.91` 公网 IP 回连宿主 mysql8/redis（同 blue_whale_server 模式；mysql8/redis 在默认 bridge、blue-whale-* 在 blue-whale_default，两 network 不通容器名）。Redis db1 与 Java db0 隔离。
6. **SESSION_SECRET 远程生成**：push.sh 远程 `openssl rand -hex 32`，不本地落盘明文（每次部署重生成 → 已登录 session 失效，可接受）。
7. **prev 二进制回滚**：restart 前备份 `new-api.prev`，回滚 = 回退 prev 重建。

## 后果

**优点**：零本地 docker；不影响同机测试；mirror fallback 抗 docker.io 墙；CGO=0 二进制可移植；回滚轻量。

**风险/权衡**：
- CGO=0 假设：未来引入 CGO 依赖（如 mattn/go-sqlite3）则本地 build 失败，需改远程 golang 镜像 build。
- classic 占位：切 classic 主题见占位页（默认 default 不影响）。
- SESSION_SECRET 每次部署重生成：已登录 session 失效。
- 外部访问依赖云安全组放行 3001：宿主 iptables 默认 ACCEPT，卡在云安全组（ssh 改不了，需云控制台）。
- 测试 MySQL 复用：new-api 库与管理员已存在（本地 go run 连测试库初始化的既成事实），部署直接复用。

## 相关

- 互补：deploy-blue-whale（Java jar 部署 skill）
- 流程约束：ADR 0010（本地 master 是用户集成区，worktree 红线）
