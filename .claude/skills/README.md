# Project Skills

本目录下的 skills 为 Claude Code **项目级 Skills**，命令名取自一级目录名（例如 `tdd/SKILL.md` → `/tdd`）。

来源：从 `BlueCode/skills-main` 包部署，按官方规范拍平为一层结构（原始分类信息保留在下方索引中作为参考）。

## 部署说明

- 官方约定路径：`.claude/skills/<skill-name>/SKILL.md`，自动发现，无需在 `settings.json` 注册。
- 项目级 skill 会覆盖同名的内置/插件 skill（本项目已覆盖：`tdd`、`code-review`、`diagnosing-bugs`、`grilling`、`domain-modeling`、`codebase-design`、`prototype`、`resolving-merge-conflicts` 等）。
- 如需临时禁用某个 skill，在 `/skills` 菜单中调整其 `skillOverrides` 状态（写入 `.claude/settings.local.json`）。

---

## Engineering（日常代码工程）

### User-invoked（仅手动 `/` 调用，`disable-model-invocation: true`）

- **[ask-matt](./ask-matt/SKILL.md)** — 询问哪个 skill 或流程适合当前情况，是本仓库 user-invoked skills 的路由器。
- **[grill-with-docs](./grill-with-docs/SKILL.md)** — 边盘问边构建项目领域模型，内联更新 `CONTEXT.md` 与 ADR。
- **[triage](./triage/SKILL.md)** — 在一组 triage 角色的状态机里推动 issue 流转。
- **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)** — 扫描代码库寻找深化机会，以可视化 HTML 报告呈现，再逐一盘问你选定的那项。
- **[setup-matt-pocock-skills](./setup-matt-pocock-skills/SKILL.md)** — 为本仓库配置工程 skills（issue tracker、triage labels、领域文档布局），每个仓库运行一次。
- **[to-tickets](./to-tickets/SKILL.md)** — 把任意 plan/spec 或当前对话拆成一组 tracer-bullet ticket，每个声明其阻塞边，发布到配置的 tracker（本地 tracker 为手写有序 `tickets.md`，真实 tracker 为原生阻塞链接，故任一阻塞完成的 ticket 都可被认领）。
- **[to-spec](./to-spec/SKILL.md)** — 把当前对话转为 spec 并发布到 issue tracker，不做访谈，只综合已讨论内容。
- **[wayfinder](./wayfinder/SKILL.md)** — 规划超出单个 agent 会话容量的庞大工作：作为 issue tracker 上的调查工单共享地图，逐一解决直到通往目的地的路径清晰。产出的是决策而非交付物。

### Model-invoked（模型或用户均可触发）

- **[prototype](./prototype/SKILL.md)** — 为回答某个设计问题而构建一次性原型：可运行的状态/逻辑终端程序，或多套可切换的 UI 变体。
- **[diagnosing-bugs](./diagnosing-bugs/SKILL.md)** — 难 bug 与性能回归的严谨诊断循环：复现 → 最小化 → 假设 → 插桩 → 修复 → 回归测试。
- **[research](./research/SKILL.md)** — 基于高可信一手来源调研某个问题，将结论以带引用的 Markdown 文件写入仓库（后台 agent 运行）。
- **[tdd](./tdd/SKILL.md)** — 红-绿-重构循环的测试驱动开发，按垂直切片逐个交付功能或修 bug。
- **[domain-modeling](./domain-modeling/SKILL.md)** — 主动构建并打磨项目领域模型：挑战术语、用场景压力测试、内联更新 `CONTEXT.md` 与 ADR。
- **[codebase-design](./codebase-design/SKILL.md)** — 设计深模块的共享规范与词汇：小接口、干净接缝、可经接口测试。
- **[code-review](./code-review/SKILL.md)** — 对自某个固定点以来的 diff 做两轴评审：**Standards**（是否符合仓库编码规范 + Fowler 坏味道基线）与 **Spec**（是否忠实实现了来源 issue/PRD），以并行子 agent 运行。

## Productivity（通用工作流，非代码专用）

### User-invoked

- **[grill-me](./grill-me/SKILL.md)** — 被持续盘问一个 plan 或设计，直到决策树的每个分支都被解决。
- **[handoff](./handoff/SKILL.md)** — 把当前对话压缩成交接文档，供另一个 agent 接力。
- **[teach](./teach/SKILL.md)** — 跨多个会话教会用户一项新技能或概念，以当前目录作为有状态的教学工作区。
- **[writing-great-skills](./writing-great-skills/SKILL.md)** — 写好/编辑 skill 的参考：让 skill 可预测的词汇与原则。

### Model-invoked

- **[grilling](./grilling/SKILL.md)** — 围绕一个 plan 或设计持续盘问用户，直到决策树的每个分支都被解决。

## Misc（保留但少用，未进入官方插件）

- **[git-guardrails-claude-code](./git-guardrails-claude-code/SKILL.md)** — 配置 Claude Code hooks，在危险 git 命令（push、reset --hard、clean 等）执行前拦截。
- **[migrate-to-shoehorn](./migrate-to-shoehorn/SKILL.md)** — 把测试文件从 `as` 类型断言迁移到 @total-typescript/shoehorn。
- **[scaffold-exercises](./scaffold-exercises/SKILL.md)** — 创建练习目录结构（章节、题目、答案、讲解）。
- **[setup-pre-commit](./setup-pre-commit/SKILL.md)** — 配置 Husky pre-commit hooks，集成 lint-staged（Prettier）、类型检查、测试。

## Personal（与个人配置绑定，未进入官方插件）

- **[edit-article](./edit-article/SKILL.md)** — 通过重组章节、提升清晰度、收紧行文来编辑改进文章。
- **[obsidian-vault](./obsidian-vault/SKILL.md)** — 在 Obsidian vault 中搜索、创建、管理笔记（wikilinks 与 index notes）。

## In Progress（实验性，尚未稳定）

仍处于开发中，可能有粗糙边缘、破坏性改动或被废弃的实验。使用时预期不稳定。

- **[loop-me](./loop-me/SKILL.md)** — 跨多个会话把自己盘问成可实施的工作流规范，以当前目录作为有状态工作区。User-invoked。
- **[wizard](./wizard/SKILL.md)** — 生成一个交互式 bash 向导，引导人类完成手动流程（初始化、一次性迁移、状态转换）——打开 URL、采集值、写入 `.env` 与 GitHub Actions secrets。User-invoked。
- **[writing-beats](./writing-beats/SKILL.md)** — 以「节拍之旅」塑造文章，choose-your-own-adventure 风格。选定起始节拍，只写那一拍，再转向下一拍，直到文章自然收尾。
- **[writing-fragments](./writing-fragments/SKILL.md)** — 盘问式会话，挖掘你的写作碎片（异质写作素材），追加到单个文档作为未来文章的原材料。
- **[writing-shape](./writing-shape/SKILL.md)** — 拿一份原材料 Markdown，逐段塑造成文章，每一步都为格式选择辩护。
- **[claude-handoff](./claude-handoff/SKILL.md)** — 把当前对话交接给一个新启动的后台 agent，通过 `claude --bg` 以交接摘要播种并立即接手工作。User-invoked。
