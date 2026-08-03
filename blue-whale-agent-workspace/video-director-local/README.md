# Video Director Local — 视频创作导演（本地版）

> 平台规范版（`Downloads/video-director-orchestration/`）的**本地适配版**。在 Claude Code / Codex 里直接用，不依赖蓝鲸平台。

## 这是什么

把平台版砍掉平台依赖、止步提示词后的本地可用版：

| 砍掉 | 替换 |
|---|---|
| 平台工具（list_creative_skills / list_canvas_nodes / create_*_generation_job 等） | 读本地 `library/_index.md`；对话上下文代替画布；不生成 |
| 画布 / GenerationJob 状态系统 | 对话内维护，无状态机 |
| 生成管线（create_video_generation_job） | **止于提示词**：交付可复制到即梦 / Seedance 的提示词包 |
| 平台铁闸 / 固定确认门 | 纯对话自然确认 |
| generation agent | 并入 prompt-optimizer 的交付包输出 |

保留：Director 自主路由、7 个创作分工 agent、爆款拆解 + 复刻工作流、108 Skill 库、Seedance 弹药库、结构配方 schema。

## 怎么用

### Claude Code

放在 `~/.claude/skills/my/video-director-local/`，Claude Code 自动发现。聊视频创作 / 拆爆款 / 写分镜 / 要 Seedance 提示词时自动激活；也可手动 `@~/.claude/skills/my/video-director-local/SKILL.md` 强制加载。

### Codex

Codex 不认 Anthropic skill 的 frontmatter，但内容是通用 markdown。用法：在对话里引用 SKILL.md，或在项目 `AGENTS.md` 里加一行指向本目录。Codex 读着按同样流程走。也可软链到 codex 配置目录双端共用（参考你已有的 seedance skill 软链做法）。

## 目录结构

```
video-director-local/
├── SKILL.md              # 根入口：Director 角色 + 意图路由
├── README.md             # 本文件
├── agents/               # 7 个子 skill
├── workflows/            # 5 个阶段编排
├── rules/                # 2 条铁律
├── references/           # 6 个按需加载
└── library/              # 108 Skill + _index.md
```

## 使用示例

**示例 1：轻量出提示词**

> 你：生成一个赛博朋克城市雨夜的视频
> → direct-generation：直接给可复制到即梦的提示词

**示例 2：完整创作**

> 你：给这个保温杯做个 30 秒 UGC 广告（附产品图）
> → full-canvas：Brief → 推荐 Skill（读 library）→ 分镜表 → 每镜 Seedance 提示词 + 关键帧生图提示词

**示例 3：爆款拆解 + 复刻**

> 你：（附一条爆款视频）拆解这个，然后照着给我的咖啡杯复刻一个
> → video-decode-replicate：Claude 看视频 → 结构配方 → 你选照搬 / 差异化 → 绑咖啡杯素材 → 分镜 + 提示词

## 能力边界

- **不生成视频**：止于提示词，你自己复制到即梦 / Seedance / 生图工具生成。
- **视频理解依赖 Claude 视觉**：能直接看大多数视频；太大 / 格式不支持时降级到抽帧 + 口述。
- **配方不跨会话**：拆解出的配方只在当前对话有效，不持久化。
- **108 Skill 库**：只读不修改，引用 `library/raw/` 原文。
- **本地版 vs 平台版**：平台版（Downloads）是给后端实现的完整规范（含生成 / 画布 / 铁闸）；本地版是个人用的提示词产出工具。
