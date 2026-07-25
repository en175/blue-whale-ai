# Web 构建身份运行态核验 Runbook（IK2BCH T6.1）

## 为什么需要

工作区源码与**实际运行的 Web 镜像**可能版本漂移：源码已含某字段（如 BottomDock 五字段透传），
但本地跑的旧镜像 bundle 还没带上。这类漂移无法被「读源码」发现，只能核**运行制品**的身份。

本 runbook 核验每个 `blue-whale-web` 运行制品携带非 `unknown` 的 Git revision + 构建时间，
并能让它被机器读取（镜像 LABEL + `/build-info` 端点），从而让运行态验收门槛可靠拦截漂移。

## 构建身份如何注入

- `blue_whale_web/Dockerfile` runner 阶段：`ARG GIT_COMMIT/BUILD_TIME` → `LABEL blue-whale.git-commit/build-time` → `ENV GIT_COMMIT/BUILD_TIME`（照搬 `blue-whale-agent-service/Dockerfile` IK1W1E 范式）。
- `deploy/local/docker-compose.yml` 的 `blue-whale-web` 服务块 `build.args` 传 `${GIT_COMMIT:-unknown}` / `${BUILD_TIME:-unknown}`。
- `scripts/run-mvp-acceptance.sh` / `scripts/local-mvp.sh` 已 `export GIT_COMMIT=$(git rev-parse --short HEAD)` + `BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)`，构建时自动注入。
- `blue_whale_web/app/build-info/route.ts` 暴露 `GET /build-info`（下划线开头目录是 Next.js 私有目录不进路由，IK2BDN 验收发现后改名） → `{ git_commit, build_time }`（读运行时 ENV）。

## 核验步骤（人工，起栈后执行）

> 端口：默认栈（`local-mvp.sh up`）Web 在 **3000**；acceptance 栈（`run-mvp-acceptance.sh`）Web 在 **3100**。
> 下面用 `$WEB_PORT` 代指，按实际栈替换。

### 1. 核镜像 LABEL（构建期注入的身份）

```bash
docker inspect blue-whale-web:local \
  --format '{{index .Config.Labels "blue-whale.git-commit"}}'
docker inspect blue-whale-web:local \
  --format '{{index .Config.Labels "blue-whale.build-time"}}'
```

预期：均非 `unknown`；`git-commit` 等于构建时 checkout 的 short SHA。

### 2. 核运行端点（运行制品真实暴露的身份）

```bash
curl -s "http://localhost:${WEB_PORT}/build-info"
# {"git_commit":"<short-sha>","build_time":"<UTC时间>"}
```

预期：`git_commit` / `build_time` 均**非 `unknown`**。

### 3. 比对三处一致

| 来源 | 值 |
|---|---|
| `git rev-parse --short HEAD`（构建时 checkout） | `<expected>` |
| `docker inspect ... blue-whale.git-commit` LABEL | 必须等于 `<expected>` |
| `curl /build-info` 的 `git_commit` | 必须等于 `<expected>` |

三处相等且非 `unknown` → 运行制品身份可核验，验收门槛可信。

## 自动核验（Playwright）

`blue_whale_web/e2e-fullstack/bottom-dock-contract.spec.ts` step 1 自动核 `/build-info` 非 `unknown`
（由 `scripts/run-mvp-acceptance.sh` 驱动）。「等于 checkout revision」的强比对留本 runbook 人工核
（Playwright 进程内无法 `docker inspect`，避免 ENV 透传复杂度）。

## 失败诊断

| 现象 | 根因 | 修复 |
|---|---|---|
| LABEL / 端点返回 `unknown` | 构建时未注入 `GIT_COMMIT`（直接 `docker build` 而非经 compose `build.args`，或未 `export`） | 走 `local-mvp.sh` / `run-mvp-acceptance.sh` 入口（已 export）；或手动 `GIT_COMMIT=$(git rev-parse --short HEAD) BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose -f deploy/local/docker-compose.yml build blue-whale-web` |
| 端点 404 | 路由目录以下划线开头被 Next.js 当私有目录（历史教训），或 route 未打进运行 bundle（旧镜像） | 路由目录不得 `_` 开头；重新构建镜像（`docker compose build blue-whale-web`）确保 `app/build-info/route.ts` 入 bundle |
| LABEL 有值但端点 `unknown` | ENV 未透传到 standalone server.js 进程 | 确认 Dockerfile runner 阶段 `ENV GIT_COMMIT=${GIT_COMMIT}` 在 `COPY --from=builder` 之前/之后均生效（ENV 是镜像层元数据，进程继承） |

## 相关

- 实现决策与契约：见 IK2BCH 计划（transcript）块 A。
- 同范式后端：`blue-whale-agent-service/Dockerfile` + `HealthController#/health`（IK1W1E）。
- 自动验收 spec：`blue_whale_web/e2e-fullstack/bottom-dock-contract.spec.ts`。
