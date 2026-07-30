# prod 视频生成 worker 部署修复

> 给后端/运维同学看。线上（115.190.244.91:3000）视频生成一直 pending、图片也出不来，根因 + 修复 + 部署步骤都在这里。

## 1. 现象

- 视频 job：提交后一直 `queued`/`pending`，永远不出片。
- 图片 job：提交很快返回，但很多卡 `queued` 不出图。
- 刷新页面也不恢复（和之前前端的假失败不是一回事）。

## 2. 根因（已 SSH 实测确认）

prod 的 `blue_whale_web` 容器是 **Next.js standalone 构建**，`CMD=["node","server.js"]`：

1. **没有 generation worker 进程**。Next 只负责把视频 job 投进 BullMQ 队列（Redis）；真正消费、调 new-api 出片、写 DB/TOS 的是独立 worker 进程（`workers/generation-worker.ts`），prod 根本没起它。所以视频 job 投进队列后无人消费 → 永远 pending。
2. **镜像里连 worker 文件都没有**。standalone 构建把 `@blue-whale/*` 打进了 `server.js`，`node_modules` 里没有这些包；`.worker-dist/` 目录也不存在。所以「在现有容器里加个启动命令」起不来 worker——必须重新 build 一个带 worker 的镜像。
3. **容器 env 名字不对 + 不全**。容器里只有 `REDIS_CONN_STRING`（不是 worker 要的 `REDIS_HOST`）、`DATABASE_URL`、`NEW_API_BASE_URL`；`VOLC_TOS_*` / `VOLC_ACCESS_KEY_ID` / `GENERATION_CREDENTIAL_SECRET` 都缺。worker 起来也会因为缺 TOS/缺 Redis 连接而崩。

> 实测证据（2026-07-30）：`docker top blue_whale_web` 只有 `next-server`，没有 worker；Redis `CLIENT LIST` 里一个 `bzpopmin` 消费者都没有；临时起一个本地 worker（连同一套 Redis/DB）后，卡住的视频 job 立刻开始处理并 succeeded。

## 3. 这个 PR 修了什么

- **代码**：`blue_whale_web/lib/generation/video-queue.ts` 的 `loadRedisConnection` 现在**回退解析 `REDIS_CONN_STRING`**（`REDIS_HOST` 缺失时）。这样 prod 只有 `REDIS_CONN_STRING` 的情况下，Next 的 enqueue 和 worker 都能连上 Redis。（此前 `REDIS_HOST` 缺失 → 默认 `127.0.0.1` → 连不上。）
  - 单测：`blue_whale_web/lib/generation/video-queue.test.ts` 加了 `REDIS_CONN_STRING` 解析 + 显式优先两条用例。
- **部署**：新增 `blue_whale_web/Dockerfile.worker`——单阶段镜像内 `pnpm install` + `prisma generate` + `build:worker`，带完整 `node_modules`，`CMD` 跑 `.worker-dist/generation-worker.mjs`。
- worker 自带 `keepAlive(30s)` + `worker.on('error')`（来自已合的 !196），远端 Redis 杀空闲连接后能自动重连、重建消费者，不会再静默掉线。

## 4. 部署步骤（后端/运维）

### 4.1 build worker 镜像

在**仓库根目录**（context 必须是仓库根，因为要 COPY `packages/*`、`pnpm-workspace.yaml` 等）：

```bash
docker build -f blue_whale_web/Dockerfile.worker -t blue-whale-worker:latest .
```

> 现有 web 镜像是「本地 next build → scp standalone → 远端 assemble」的流程，**不适用** worker（standalone 没打 worker）。worker 镜像必须在仓库根用上面这条 build（或 CI 里 build 完推到远端）。

### 4.2 起 worker 容器

两种方式任选。

**方式 A：docker-compose（推荐，跟着现有 compose 走）**

在跑 `blue_whale_web` 的那份 compose 里加一个服务：

```yaml
  blue-whale-worker:
    image: blue-whale-worker:latest
    container_name: blue-whale-worker
    restart: unless-stopped
    environment:
      # —— 必填 ——
      - DATABASE_URL=mysql://root:weitian1024@mysql8:3306/blue_whale   # 用你们实际的 DB 地址（容器名或外部 IP）
      - REDIS_CONN_STRING=redis://:weitian1024@redis:6379/0            # 或拆成 REDIS_HOST/REDIS_PORT/REDIS_DB/REDIS_PASSWORD
      - NEW_API_BASE_URL=http://blue_whale_api:3000                    # new-api(Go 网关)地址，容器名或外部 IP
      - VOLC_ACCESS_KEY_ID=AKLTNTdhNjI5MjM0YzE1NDAwODllMWE2OTA1ODJiMDJiZmQ
      - VOLC_SECRET_ACCESS_KEY=T0RFeE1HTTRZbUZqTVRjeU5HSXdZV0ZpWkRZNE9UY3dNMlEzTVRsallqUQ==
      - VOLC_TOS_ENDPOINT=tos-cn-beijing.volces.com
      - VOLC_TOS_BUCKET=bluewhale-assets
      - VOLC_TOS_REGION=cn-beijing
      - GENERATION_CREDENTIAL_SECRET=blue-whale-dev-secret-key-at-least-256-bits!!   # 要和 Next 那边一致（seal/open credential 用）
      # —— 可选 ——
      - GENERATION_WORKER_PORT=4002
      - GENERATION_WORKER_CONCURRENCY=8
      - GENERATION_RECOVERY_INTERVAL_MS=60000
    # 端口不用对外（/ready 只是探活）；要监控就映射 4002
```

> ⚠️ `DATABASE_URL` / Redis / `NEW_API_BASE_URL` 的 host：在同一个 docker 网络里用**容器名**（`mysql8`/`redis`/`blue_whale_api`）；跨网络用外部 IP。务必和 `blue_whale_web` 容器用的是**同一套 DB + 同一个 Redis 库**，否则 job 对不上。

**方式 B：docker run（快验证用）**

```bash
docker run -d --name blue-whale-worker --restart unless-stopped \
  --network <blue_whale_web 所在网络> \
  -e DATABASE_URL=... \
  -e REDIS_CONN_STRING=redis://:weitian1024@redis:6379/0 \
  -e NEW_API_BASE_URL=http://blue_whale_api:3000 \
  -e VOLC_ACCESS_KEY_ID=... -e VOLC_SECRET_ACCESS_KEY=... \
  -e VOLC_TOS_ENDPOINT=tos-cn-beijing.volces.com \
  -e VOLC_TOS_BUCKET=bluewhale-assets -e VOLC_TOS_REGION=cn-beijing \
  -e GENERATION_CREDENTIAL_SECRET=... \
  blue-whale-worker:latest
```

### 4.3 worker 必填 env 速查

| env | 用途 | 来源 |
| --- | --- | --- |
| `DATABASE_URL` | 读写 generation_jobs | 和 `blue_whale_web` 同一个 |
| `REDIS_CONN_STRING` 或 `REDIS_HOST/PORT/DB/PASSWORD` | BullMQ 队列 | 和 `blue_whale_web` 同一个 Redis、同一个 db |
| `NEW_API_BASE_URL` | 调 new-api(Go) 出视频 | new-api 地址 |
| `VOLC_ACCESS_KEY_ID` + `VOLC_SECRET_ACCESS_KEY` | TOS 写片 | 火山账号 AK/SK |
| `VOLC_TOS_ENDPOINT` / `VOLC_TOS_BUCKET` / `VOLC_TOS_REGION` | TOS 写片 | 和 web 侧一致 |
| `GENERATION_CREDENTIAL_SECRET`（或 `JWT_SECRET`） | 解密 provider credential | **必须和 Next 那边一致**（不然视频带凭证的 job 解不开） |

worker 缺 `DATABASE_URL` / `NEW_API_BASE_URL` / TOS 任一会启动即崩（代码里 throw）。

## 5. 验证

worker 起来后：

1. `docker logs blue-whale-worker` —— 不应有 throw（缺 env 会立刻崩）。
2. Redis 上应出现阻塞消费者：
   ```bash
   redis-cli -a weitian1024 CLIENT LIST | grep -o 'cmd=bzpopmin' | wc -l   # 应 ≥1
   ```
3. worker 的 recovery scan（启动跑一次 + 每 60s）会把卡在 DB 里 `queued` 的视频 job 重新捞进队列 + 处理。提一个新视频 job，应在几分钟内变 `processing` → `succeeded`。
4. worker 自带 `/ready`（默认 4002）：`curl localhost:4002/ready` 返回 `{"status":"ready"}`。

## 6. 备注

- **图片生成**（Next 路由内联 `processJob`）不在本 worker 范围。但 prod 图片卡住多半也是因为容器缺 `VOLC_ACCESS_KEY_ID`/`VOLC_TOS_*` env（image 走火山 ARK 直连需要这些）——确认 `blue_whale_web` 容器补全这些 env 后图片应恢复。
- worker 跑成后，之前卡住的 queued 视频 job 会被 recovery scan 自动处理；不用手动清。
- new-api（Go 网关）侧：确保对应账号/token 的 **vip 分组**可用（曾因 vip 分组被删导致 403 全挂）。worker 只是把请求转发给 new-api，vip 分组在 new-api 后台配。
