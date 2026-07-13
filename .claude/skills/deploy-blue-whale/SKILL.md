---
name: deploy-blue-whale
description: Build the blue-whale backend (gateway/user/agent) into jars locally with Maven, scp jars + Dockerfiles to remote server 115.190.244.91, build Docker images remotely, then detect running containers and restart them. Use when the user wants to deploy / publish / ship the backend, or says "部署"/"发布"/"推到服务器"/"打jar推上去".
disable-model-invocation: true
---

# Deploy Blue-Whale（jar → 远程 build 镜像）

本地 `mvn package` 打后端 jar → scp 到 `115.190.244.91` → **远程 `docker build` 成镜像** → 检测容器重启。
仅手动 `/deploy-blue-whale` 触发（生产部署，禁止 agent 自动）。

> 为什么远程 build：本地不碰 docker（绕过 docker.io 被墙），jar 小传得快；镜像在远程 build，base image 由远程拉（远程网络或已配 mirror）。

## 范围

- **仅后端 3 服务**：gateway(8686) + user(8081) + agent(8082)。
- 前端不在本流程（Next.js 非 jar，另行处理）。
- 全部流量走网关：gateway 对外，user/agent 内部，由 gateway 经 Nacos 发现路由。
- 依赖 nacos/mysql/redis 已在 `115.190.244.91` 运行，后端 yml 直连服务器公网 IP。
- SSH：`ssh -i /Users/apple/Downloads/weitian.pem root@115.190.244.91`。

## 前置检查（首次部署前）

1. **本地 Maven**：`mvn -v` 能跑（打 jar 用，不需本地 docker）。
2. **远程 docker + compose v2**：`ssh -i /Users/apple/Downloads/weitian.pem root@115.190.244.91 'docker version; docker compose version'`。
3. **远程能拉 base image**（远程 build 关键）：`ssh ... 'docker pull eclipse-temurin:21-jre'`。拉不到 → 给远程 `/etc/docker/daemon.json` 配 `registry-mirrors`（如 `https://docker.1ms.run`）后 `systemctl restart docker`。
4. **远程 .env**：`/opt/blue-whale/.env` 含 agent 的 OSS 凭证：
   ```
   TOS_ACCESS_KEY=...
   TOS_SECRET_KEY=...
   TOS_BUCKET_NAME=...
   ```
5. **MySQL 库表**：`blue_whale` 库已建，用 `blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/resources/db/schema.sql`。
6. **Nacos**：namespace `1bb06cf5-...` 存在，gateway 路由配置就绪（含 /assets 转发到 agent）。
7. 密钥权限：脚本自动 `chmod 600`。

## 用法

一键全流程（build jar → push → remote build → restart）：

```bash
bash .claude/skills/deploy-blue-whale/scripts/deploy.sh            # 全部 3 服务
bash .claude/skills/deploy-blue-whale/scripts/deploy.sh agent      # 只 agent
bash .claude/skills/deploy-blue-whale/scripts/deploy.sh gateway user  # 指定多个
```

分步：

| 脚本 | 作用 |
|---|---|
| `scripts/build.sh` | 本地 `mvn package` 打 fat jar |
| `scripts/push.sh` | scp jar + Dockerfile.* + compose 到 `/opt/blue-whale/` |
| `scripts/remote-build.sh` | 远程 `docker build` 把 jar 打成 `blue-whale-<svc>:latest` |
| `scripts/restart.sh` | 检测同名容器 → `docker rm -f` → `docker compose up -d` 重建 |

覆盖配置（环境变量）：`DEPLOY_KEY` / `DEPLOY_HOST` / `DEPLOY_USER` / `REMOTE_DIR`。

## restart 逻辑（判断是否启动 → 关闭 → 重启）

逐服务：`docker ps -a` 查同名容器（覆盖 docker run/compose 两种起法）→ 在跑则 `docker rm -f` → `docker compose up -d` 用新镜像重建。

## ⚠️ 注意点

- **Java 版本**：parent 锁 17 编译，远程 Dockerfile 用 `temurin:21-jre` 运行（17 编译的 jar 21 兼容）。要严格对齐改 3 个 Dockerfile。
- **Nacos 注册 IP**：后端容器化后注册到 Nacos 的 IP 可能是容器内网 IP。同 compose 网关可达；跨主机或注册成宿主 IP 则配 `spring.cloud.nacos.discovery.ip`。首次部署观察 gateway 路由是否命中。
- **远程拉镜像失败**：`remote-build.sh` 会报错指路——给远程 docker 配 `registry-mirrors`。
- **gateway 分离 lib**：若 gateway 不是 fat jar（spring-boot 分离打包），`Dockerfile.gateway` 要补 `COPY lib lib` + `COPY config config`（参考项目原有 `blue-whale-gateway/Dockerfile`）。

## 触发示例

用户："部署后端" / "打 jar 推上去" / "发布" → `deploy.sh`。
用户："只重新部署 agent" → `deploy.sh agent`。
用户："远程镜像重 build 但不改 jar" → `remote-build.sh && restart.sh`。
