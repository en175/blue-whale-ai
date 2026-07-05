# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库结构（双层，非 monorepo）

- **Repo 根** (`/`)：领域文档与 AI 工具配置。`CONTEXT.md`(领域词汇)。
- **应用代码** 在 `blue_whale/` 子目录（注意：与仓库名 `blue-whale-ai` 不同）。所有构建命令都在此目录下运行。
- 路径别名：`@/*` → `blue_whale/./*`。
- 上下文记录：`blue_whale/docs/` 下编号递增的 `NNN-context.md`，**按序号降序**读取最新内容。
- `deer-flow/` 是**第三方参考项目**（bytedance/deer-flow，独立 git 仓库），仅供查阅。**除非用户明确要求，不要读取、修改或构建它。**

## 技术栈（保留现状，不迁移）

Next.js (App Router) + React + TypeScript (`strict: true`) + Tailwind **v3**（不是 v4）+ @emotion + framer-motion + lucide-react。包管理器为 **npm**（不是 pnpm/yarn）。版本号见 `blue_whale/package.json`。

> **不做技术栈迁移或大规模重构。** 保留现有 React/Next 栈。

## 关键约束：Next.js 16 是非常新版本

**这不是你训练数据里的 Next.js。** API、约定、文件结构可能都不同。写任何 Next 代码前，先读 `blue_whale/node_modules/next/dist/docs/` 里的官方指南，留意 deprecation 提示。详见 `@blue_whale/AGENTS.md`。

## 构建命令（均在 `blue_whale/` 下运行）

```bash
npm run dev        # next dev
npm run dev:lan    # next dev -H 0.0.0.0（LAN 可访问）
npm run build      # next build
npm run start      # next start
npm run start:lan  # next start -H 0.0.0.0
npm run lint       # eslint
npm test           # vitest run
```

- **没有 format 脚本。** 测试用 `npm test`（vitest）；类型检查用 `npx tsc --noEmit`。
- **无 CI、无 pre-commit hook、无格式化器**（仅 Next 默认 ESLint flat config）。

## 两个有意保留的巨石文件

`blue_whale/app/canvas/page.tsx` 是 ~285 行的编排层，UI 实现在 `app/canvas/_canvas/` 子目录（18 个文件，最大 `components/dock/VideoDockContent.tsx` ~1170 行）。`blue_whale/components/AgentComposer.tsx`（~1500 行）仍是单文件巨石。**迁移已取消，除非用户明确要求，不要主动拆分或重构它们。**

## 领域术语（勿用同义词）

`Canvas` / `AgentComposer` 是代码术语，不是普通词。完整定义见 `@CONTEXT.md`。文档与代码命名须与之一致，避免"画布/编辑器/编排器"等同义词。

## 协作：用 Gitee，不用 GitHub

- Issue/PRD 在 Gitee 仓库 `hangzhou-xuanfu_1/blue-whale-ai`，通过 **Gitee MCP**（`mcp__gitee__*`）读写，**不要用 `gh` CLI**。
- 外部 PR 不是 triage 入口，只 triage issue。5 个 triage 标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`（需通过 Gitee MCP 验证是否已预创建）。
- `.mcp.json` 已 gitignore，新环境需手动配置 Gitee MCP 并自备 `GITEE_ACCESS_TOKEN`。
- **`@gitee/mcp-gitee` native binary 多处 `404 Not Found Project` bug**（Go 编译、源码不可读；REST 直连正常）：
  - **owner 必须用连字符 `hangzhou-xuanfu_1`**（仓库实际路径）。下划线写法在 `list_repo_issues` 不报错，但在 `get_repo_issue_detail` / `list_comments` / `create_comment` / `update_issue` 上 404——凡操作单个 issue 都必须用连字符。
  - **`list_repo_issues({ state: "open" })`** 直接 404。**Workaround**：传 `state: "all"` 客户端按 `i.state === "open"` 过滤；或 `node blue_whale/scripts/gitee-issues.mjs list open` 走直连 wrapper。其它 state 值正常。

## 后端未定

当前是纯前端 SPA，生成能力用 mock/临时方案。**没有可写入的 API base URL 或鉴权方式** —— 若涉及真实接口，先问用户。

无 `.env.example`；`.env*` 被 `blue_whale/.gitignore` 忽略，不入库。

## 已知 gotchas

- **图片远程域名白名单**：`next.config.ts` 仅允许 `dj5nb01yl89hl.cloudfront.net`（CloudFront）。加新图源需改该配置。
- **`sharp` 未列入 package.json**，但被 `blue_whale/compare-images.mjs` 使用，直接运行会失败。
- **截图脚本硬编码他人机器路径**（`/Users/apple/Desktop/...`），换环境即失效。
- **`blue_whale/scripts/` 下的截图/检查脚本**不在 npm scripts 内，需手动 `node scripts/xxx.mjs` 运行，依赖 devDependencies 里的 playwright。
- UI 为中文（`lang="zh-CN"`），aria-label、文案多为中文。

## 关于 `.claude/skills/`

`.claude/skills/` 下是通用工程 skill 库（Matt Pocock skills 等），与本项目业务代码无关。**业务约定以本 CLAUDE.md + `CONTEXT.md` 为准**，不要把 skill 里的通用流程（如 pre-commit、TDD）当作本项目既定规范套用。
