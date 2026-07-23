# 首版 Runtime Bundle（Director v1.0.0）

本目录是首版 Runtime Agent Bundle 的**维护源**（IK2D8R）。它从 `../skill/` 历史资产审计提炼而来，
只包含 Director 运行所必需的最小闭包，可构建、可导入、可静态校验、可在隔离环境被 Worker 装载运行。

- 契约权威：[`docs/specs/2026-07-20-runtime-agent-bundle-contract.md`](../../docs/specs/2026-07-20-runtime-agent-bundle-contract.md)（Accepted v1）
- 迁移清单（每个历史资源的保留/重写/归档/拆分结论）：[`docs/wayfinder/IK2D8R-first-runtime-bundle-migration.md`](../../docs/wayfinder/IK2D8R-first-runtime-bundle-migration.md)

## 组成

| 资源 | 种类 | loadMode | 说明 |
|---|---|---|---|
| `resources/AGENTS.md` | RoleDocument | always_on | Director 身份、职责、协作边界、用户可见输出原则 |
| `resources/rules/natural-confirmation.md` | Rule（confirmation） | always_on | 自然语言确认原则：弱继续不构成高成本/不可逆授权，无确认按钮 |
| `resources/rules/progressive-disclosure.md` | Rule（disclosure） | always_on | 渐进式披露：一轮最多 3 问，方向歧义才追问 |
| `resources/rules/conversation-canvas-facts.md` | Rule（facts） | always_on | Conversation + Canvas 事实边界：画布只承载 Asset 素材视图 |
| `resources/rules/output-boundary.md` | Rule（output） | always_on | 用户可见输出边界 |
| `resources/skills/director-workflow/SKILL.md` | 根 RuntimeSkill | on_demand | 顾问式多轮工作流（咨询/澄清/推荐/提议/跟进），元数据进初始上下文 |
| `resources/references/generation-action-guide.md` | Reference | on_demand | GenerationJob 动作提议参数指引，被根 Skill 确定引用 |

初始上下文 = RoleDocument + 4 条 always_on Rules + 根 Skill 元数据（含按需读取寻址键）。
Creative Skill 正文与 `../skill/library/raw` 创作模板**不进入**本 Bundle（归 Creative Skill 库，见迁移清单）。

## 构建与校验

```bash
python3 build.py          # 组装并写入 dist/first-runtime-bundle.json
python3 build.py --check  # 校验并确认 dist 与源一致
```

`build.py` 仅依赖 Python 标准库：计算 contentDigest / sizeBytes / tokenEstimate（chars_div_4，
与 Java 发布侧逐字节一致），校验资源形状、引用闭包与环、conflictDomain 唯一、Role/根 Skill 唯一、
token 预算三门，并用与 Java 对齐的规范化算法计算 manifestDigest。

**`dist/` 是本地生成物（`.gitignore` 忽略，不入库）**；自动化测试各自现场重建包，
干净 clone 上无需先手工构建。

## 导入与验证

`dist/first-runtime-bundle.json` 是与控制面导出格式兼容的便携包（`format_version: 1`，资源正文内联）：

- 导入：先 `python3 build.py` 生成本地包，再 `POST /internal/runtime-bundles/agents/{agentDefinitionId}/import`
  （管理员）。导入只形成 BundleDraft，随后走 validate → publish → activate 标准生命周期。
- 静态校验 IT：`FirstRuntimeBundleImportIT`（自动运行 build.py → 导入 → Draft 校验 → 发布 → 导出资源级往返一致）。
- 行为评测与隔离装载：`blue_whale_agent_worker/tests/test_first_runtime_bundle.py`
  （build.py 现场组装 + FakeBundleSource 全离线，覆盖行为样例与 fail closed 矩阵）。

## 版本规则

- Bundle SemVer：`bundle-source.json` 的 `version`；任何内容变化产生新版本与新摘要（契约 §3.1）。
- 资源 `revision`：同一 `resourceId` 单调递增；改内容必须升 revision。
- 每次修改 `resources/` 或 `bundle-source.json` 后跑 `python3 build.py --check` 自检即可，测试会覆盖新鲜度。
