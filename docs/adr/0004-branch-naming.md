# ADR-0004：分支命名规范 —— 强制白名单 + 中文标题

- **状态**：Accepted
- **日期**：2026-07-05
- **决策者**：JJNNReno（与 Claude Code 经 `/grill-with-docs` 会话共同得出）

## 背景

分支命名规范此前散落多处（`CLAUDE.md` 零散前缀、`README.md`「命名建议」、`scripts/block-dangerous-git.sh` + `.githooks/pre-push` 实际强制、[ADR-0003](0003-no-direct-push-to-master.md) 提 `hotfix`），且：

1. **文档软、代码硬**：`README.md` 写「命名**建议**」，但 `block-dangerous-git.sh` 与 `pre-push` 实际把 `{feature, fix, hotfix}` 当**强制白名单**执行。新人按「建议」起 `chore/cleanup`，rebase 后强推被拦。
2. **前缀缺口**：白名单 `{feature, fix, hotfix}` 与 Conventional Commits `{feat, fix, docs, refactor, chore, …}` 不对齐。改 docs / 重构 / 杂项无合规前缀可用。
3. **feat vs feature**：commit 用 `feat`，branch 用 `feature`，拼写不统一，未说明是否刻意。
4. **无标题格式、无生命周期、无保护分支显式定义**。

## 决策

### 1. 强制白名单（非建议）

承认 hook 既成事实，定前缀白名单为**强制**。权威源单一化：[docs/agents/branch-naming.md](../agents/branch-naming.md) 是规则源，`CLAUDE.md` 只导航，hook 执行。三者同源维护。

### 2. 白名单扩为 {feature, fix, hotfix, docs, chore}

- 加 `docs/`：本项目文档密集（`CLAUDE.md` / ADR / `docs/agents/*` / `README.md`），现状无合规前缀，刚需。
- 加 `chore/`：构建 / 脚本 / 配置 / CI 杂项。
- `refactor/` 不单列：归 `feature/` 或 `fix/`。边界模糊，单列收益低。
- 不加 `release/`（无发布分支线，见 [ADR-0003](0003-no-direct-push-to-master.md)）/ `ci/build/perf/test`（太细，归 `chore/` 或 `feature/`）。

### 3. 前缀粒度 = 任务级（非提交级）

分支前缀表达「这批改动啥性质/啥流向」，不是「单次提交啥类型」。一个 `feature` 分支可含 `feat`+`docs`+`refactor` 多次提交。提交级语义用 Conventional Commits。两者不该 1:1 对齐——对齐 = 白名单膨胀 + 每加一前缀改 hook，收益低。

### 4. feat(commit) vs feature(branch) 刻意不统一

commit 遵 Conventional Commits 标准（`feat` 是规范缩写），branch 遵业界惯例（`feature/` 常见，`feat/` 罕见）。各自遵各自规范，文档点明刻意，免后人纠结。

### 5. 中文标题（前缀英文 + 标题中文）

骨架 `<前缀>/<工单号>-<中文简述>`。前缀英文（hook bash glob 匹配需 ASCII），标题中文（团队中文母语，可读性优先）。工单号 = Gitee issue 标识符（字母数字串，**非纯数字**），有则必带、原样保留大小写，无则省。

接受中文分支名风险（URL 编码 / shell 转义 / 跨平台兼容），mitigation：全团队用 Gitee，不涉 GitHub / 海外 CI；hook 已实测 UTF-8 glob 兼容。

### 6. 标题格式统一

动宾结构、6–15 字、分隔仅 `/`+`-`、简述部分小写（工单号保留 Gitee 原样大小写）、禁空格 / 下划线 / 纯英文标题。

### 7. 生命周期：合并即删

不设保留期。代码历史在 git log + PR 记录，删分支不丢历史。

### 8. 保护分支 = {master}

显式定义。三禁：直推 / force-push / 删除。

## 考虑过的备选

- **A（维持「建议」语气）**：否决——hook 已强制，文档弱化只制造困惑，新人踩坑。
- **B（白名单对齐 Conventional Commits 全集）**：加 `refactor/ci/build/perf/test/release`：否决——粒度过细，hook 维护成本高，且分支是任务级非提交级，1:1 对齐是误区。
- **C（统一 feat/feature）**：让 commit 用 `feature` 或 branch 用 `feat`：否决——前者偏离 Conventional Commits 标准，后者偏离分支命名惯例。
- **D（ASCII 分支名，英文/拼音标题）**：否决——团队中文母语，可读性优先；全 Gitee 环境中文风险可控。

## 后果

- **正面**：文档与代码一致（强制 vs 强制）；`docs`/`chore` 改动有合规前缀；规则单一权威源（`branch-naming.md`），改一处；中文标题可读性高；`feat`/`feature` 差异有据可查。
- **负面 / 代价**：
  - 中文分支名在 URL / 日志需 percent-encode（可读性略降），接受。
  - 白名单扩展后 hook 改动（`block-dangerous-git.sh` + `pre-push`），已同步。
  - 前缀有限，`refactor` 类需归入 `feature/fix`（语义略宽泛），接受。

## 参考

- 规则源：[docs/agents/branch-naming.md](../agents/branch-naming.md)
- 相关：[ADR-0003](0003-no-direct-push-to-master.md)（禁直推 master）、`CLAUDE.md`「提交与审查」、`scripts/block-dangerous-git.sh`、`.githooks/pre-push`
- 会话来源：`/grill-with-docs` 决策树（Q1–Q6）
