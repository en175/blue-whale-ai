# Java 物理退役实施计划

**日期：** 2026-08-03
**任务分支：** `chore/物理退役Java运行时`（worktree `../blue-whale-worktrees/chore-81703ee9`）
**依据：** `docs/specs/2026-08-03-ik50gb-c-java-retirement-media-auth-design.md` §3、`docs/specs/2026-08-03-ik50gb-c-closure-implementation-plan.md` Task 4

**前置条件（已满足）：** IK50GB-C 无 Java 真实验收已合入本地 master（`cb8c20b7` → merge `5cf9b1d0`）。

## 1. 删除前迁出核对（设计文档 §3.1）

| 迁出项 | 事实所有者 | 状态 |
|---|---|---|
| 数据库 migration/seed | `packages/persistence/schema/001_baseline.sql` | ✅ 已存在并被验收使用 |
| 跨进程协议 | `packages/contracts` + TS 契约文档 | ✅ 已存在 |
| 必需测试 fixture | `tests/typescript-baseline/` | ✅ provider-stub 等已就位 |
| 部署参数 | `deploy/typescript-baseline/` + `Dockerfile.typescript-baseline` | ✅ 已是当前验收基线 |

历史 ADR / 研究文档保留原始记录，不篡改历史事实；本计划与后续提交记录退役动作本身。

## 2. 删除范围（盘点实测结果）

1. **`blue_whale_server/`** 整树：1082 个 `.java`、31 个 `pom.xml`、mvnw、各模块 `.volcano`。
2. **`deploy/local/`** 整目录：Java Compose 栈（nacos/gateway/user/agent/schema-migration）、验收模板、脚本、`.env.example`。
3. **Java 时代脚本**（仅互相引用且引用 deploy/local，无其他调用方）：
   - `scripts/run-mvp-acceptance.sh`（IK1NS2）
   - `scripts/run-template-acceptance.sh`（IK1W1K）
   - `scripts/local-mvp.sh`（IK1NRX）
   - `scripts/run-schema-acceptance.sh`（IK1W1E/IK1W1J）
4. **Java 部署 skills**：`.claude/skills/deploy-blue-whale/` 与 `.qoder/skills/deploy-blue-whale/`（构建 gateway/user jar 的部署入口）。保留 `deploy-blue-whale-api`（new-api/Go，现役）。
5. **`.githooks/pre-commit`** 中 `blue_whale_server/.*\.py` 语法检查块（约 91–103 行）。
6. **`.gitee/PULL_REQUEST_TEMPLATE.md`** 第 55 行 HTML 注释措辞更新（去除 blue_whale_server 表述）。

## 3. 明确不删（范围外）

- `blue_whale_pay_server/`、`blue_whale_pay_web/`：独立支付产品线（ADR-0025），不属本次退役。
- `blue_whale_agent_worker/`（Python）：Java/Python 双退役归同事工单 IK5Q1Y 统筹；其 Dockerfile 对 deploy/local 的引用仅是注释，随删除修正该句。
- `blue_whale_web/lib/auth/sms.ts`：注释性引用，属 IK50GD 旧账户语义收口范围。
- `docs/**` 历史 ADR / 研究 / 项目档案：保留，不改写历史。

## 4. 防回归（设计文档 §3.3）

- 扩展 `tests/typescript-baseline/no-java-runtime.test.mjs`：新增断言 `blue_whale_server/` 与 `deploy/local/` 目录不得重新出现。
- 现有 forbidden 字符串守卫（GATEWAY_URL / blue-whale-gateway / blue-whale-user / blue_whale_server）继续覆盖生产路径。

## 5. 验证

1. `node --test tests/typescript-baseline/no-java-runtime.test.mjs`
2. `pnpm typecheck`
3. `pnpm --filter blue_whale test`
4. `scripts/run-typescript-baseline-acceptance.sh`（证明删除未破坏验收）
5. `python3 -m unittest scripts.tests.test_run_ik50gb_c_testsite_probe`
6. `git diff --check`

## 6. 提交形态

按设计文档 §5：单一可审查提交 `refactor: 物理退役 Java 运行时`（计划文档先行一个 `docs:` 提交）。
