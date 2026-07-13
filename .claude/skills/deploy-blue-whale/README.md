# deploy-blue-whale

后端 jar 部署 skill：本地 `mvn package` 打 jar → scp 到远程 → 远程 `docker build` 成镜像 → 检测重启。

## 流程

```
本地 mvn package ──jar──▶ scp ──▶ 远程 /opt/blue-whale/jars/
                                        │
                       远程 docker build（COPY jar + temurin:21-jre）
                                        │
                          blue-whale-<svc>:latest
                                        │
                    restart.sh：检测旧容器 → docker rm -f → compose up -d
```

## 目录结构

```
.claude/skills/deploy-blue-whale/
├── SKILL.md                     # /deploy-blue-whale 入口
├── README.md                    # 本文件
├── scripts/
│   ├── lib.sh                   # 公共配置（密钥/主机/SSH/find_jar）
│   ├── build.sh                 # 本地 mvn package 打 jar
│   ├── push.sh                  # scp jar + Dockerfile + compose
│   ├── remote-build.sh          # 远程 docker build 镜像
│   ├── restart.sh               # 远程检测 + 关闭 + 重建
│   └── deploy.sh                # 一键串联
└── docker/
    ├── Dockerfile.gateway       # jar-based（远程 build 用）
    ├── Dockerfile.user
    ├── Dockerfile.agent
    └── docker-compose.remote.yml  # 3 后端编排（scp 到远程 docker-compose.yml）
```

## 本次改动文件（未提交 git，等审查）

| 文件 | 动作 |
|---|---|
| `.claude/skills/deploy-blue-whale/**` | 新增（本 skill） |
| `blue_whale_web/next.config.ts` | **改动**：`output:'standalone'` + rewrite 目标 env 化（`GATEWAY_URL`），`/assets` 走网关。前端虽不在本流程部署，但改动无害（dev 默认 localhost），保留备用 |

> 已删：之前生成的 `blue_whale_web/Dockerfile`、`blue_whale_web/.dockerignore`、agent multi-stage Dockerfile（前端不部署 + 改 jar 方案）。
> 保留：项目原有 `blue-whale-gateway/Dockerfile`、`blue-whale-user/.../Dockerfile`、`docker-compose.yml`（非本 skill 所建，未动）。

## 远程环境假设（从后端 application.yml 核对）

- 服务器 `115.190.244.91`，SSH `root@` + `/Users/apple/Downloads/weitian.pem`。
- nacos(8848)/mysql(3306,blue_whale,root/weitian1024)/redis(6379,weitian1024) 已在服务器运行——yml 直连公网 IP。
- 远程需装 docker + docker compose v2，且能拉 `eclipse-temurin:21-jre`。
- 远程**不需**装 Java（用 docker 镜像内 JRE）。

## 首次部署步骤

1. 本地 Maven：`mvn -v`。
2. 远程 docker + 拉镜像：
   ```bash
   ssh -i /Users/apple/Downloads/weitian.pem root@115.190.244.91 'docker compose version && docker pull eclipse-temurin:21-jre'
   ```
   拉不到镜像 → 远程配 mirror：
   ```bash
   ssh -i /Users/apple/Downloads/weitian.pem root@115.190.244.91 'cat > /etc/docker/daemon.json <<EOF
   {"registry-mirrors":["https://docker.1ms.run","https://docker.m.daocloud.io"]}
   EOF
   systemctl restart docker'
   ```
3. 远程建目录 + .env：
   ```bash
   ssh -i /Users/apple/Downloads/weitian.pem root@115.190.244.91 'mkdir -p /opt/blue-whale'
   # 再把 TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET_NAME 写进 /opt/blue-whale/.env
   ```
4. MySQL 建库表（用 `blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/resources/db/schema.sql`）。
5. 跑 `bash scripts/deploy.sh`。

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `build.sh` 找不到 jar | mvn 失败，看 mvn 输出；或 jar 名不匹配 `blue-whale-*.jar`，查 target/。 |
| `remote-build.sh` 拉不到 temurin | 远程 docker 没配 mirror，按上方"首次部署步骤 2"配。 |
| 后端容器起不来 | `docker logs blue-whale-agent`：多半连不上 nacos/mysql/redis（防火墙未放行 8848/3306/6379），或 .env 缺 TOS_*。 |
| gateway 路由打不到 agent/user | Nacos 注册 IP 是容器内网 IP，gateway 同网络可达；跨主机配 `spring.cloud.nacos.discovery.ip`。 |
| gateway build 后跑不起来 | gateway 可能非 fat jar（分离 lib），`Dockerfile.gateway` 补 `COPY lib lib` + `COPY config config`。 |

## 安全约束

- 部署到生产 = outward-facing。脚本只做 build/push/remote-build/restart，**不碰 git**（不提交/推送/PR），符合仓库 git 红线。
- `disable-model-invocation: true`：agent 不自动部署，必须手动 `/deploy-blue-whale` 或显式跑脚本。
