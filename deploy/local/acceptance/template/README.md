# 模板推荐链路验收（IK1W1K）

真实 MySQL 验证模板推荐完整链路：版本化迁移把模板表升级为公共持久化字段、
幂等种子就位、分页公开 API 返回非空稳定分页、意外数据库异常对 User 统一脱敏
且服务端日志可用 Request ID 关联底层原因。架构背景见
[ADR-0037](../../../../docs/adr/0037-schema-migration-framework.md) 与
[schema-migration README](../schema-migration/README.md)。

## 场景

| 场景 | 夹具 | 验证点 |
|------|------|--------|
| empty | 无（空卷） | 迁移 V1→V2→V3→V4→V5：新公共字段就位（V5）、旧列删除、32 卡片/96 图片种子、每标签非空；agent 分页 API（5 个有效标签）HTTP 200 + code=200 + PageVo 稳定 + 首页按 sort_order；DROP 图片表注入异常：响应统一「服务暂时不可用」不泄漏原因，日志含 X-Request-Id 与底层原因 |
| upgrade | `../schema-migration/fixtures/old-baseline.sql` + `fixtures/template-old-seed.sql` | 旧结构 + 既有 32/96 模板：记录、主键（1..32）、图片关联原样保留，旧列值搬入新列；迁移容器重复执行数量不变；API 返回既有数据 |
| backfill | 仅 `old-baseline.sql`（旧结构、0 模板） | 升级后补齐 32/96 种子；重复执行无重复模板/图片 |

## 运行

```bash
# 前置：:acceptance 镜像需已用当前源码构建
docker compose -p bw-mvp-acceptance \
  -f deploy/local/docker-compose.yml \
  -f deploy/local/docker-compose.acceptance.yml build blue-whale-agent

scripts/run-template-acceptance.sh           # 全部三个场景
scripts/run-template-acceptance.sh empty     # 单场景
```

三个场景各自独立 Compose 项目（bw-template-*），结束 `down -v` 清理，可重复执行。
