# 前端提交守门（prettier + lint-staged）

> 配套 IJZYVJ 实现：把"代码格式化"从手动约定升级到**强制守门**——未格式化的代码无法 commit，lint error 无法自动修时也会被拦。

## TL;DR

| 你做了啥 | 会发生啥 |
|---|---|
| 改 blue_whale_web/ 下 ts/tsx/js/jsx/mjs/css/md/json 文件 → `git commit` | pre-commit 钩子跑 `lint-staged`：先 `prettier --write` 修格式，再 `eslint --fix` 修可修的 lint。能修就修了、然后 commit 包含修后版本 |
| 故意提交一个有 ESLint error（语法错、unused var 之类）的文件 | `eslint --fix` 修不了 → lint-staged 返回非零 → pre-commit **硬拦** |
| 改 `blue_whale_web/` 以外的文件 | 不触发这套前端 lint-staged；其他路径按各自验证策略处理 |

## 本地启用

仓库已经有 `.githooks/` 体系，`git config core.hooksPath .githooks` 通过 `scripts/setup-hooks.sh` 设置。**前端 pre-commit 守门不引 husky**——本仓库的钩子管理器是仓库根的 `.githooks/`（避免 hooksPath 二选一冲突）。详见下方"为什么不用 husky"。

Clone 后一次性：

```bash
bash scripts/setup-hooks.sh
pnpm install --frozen-lockfile
```

之后所有 `git commit` 自动跑守门。

## 守门规则细节

`.githooks/pre-commit` 中关于前端的逻辑：

1. 检测到 staged 文件含 `blue_whale_web/` 前缀 → 触发 lint-staged
2. lint-staged 按文件类型分两组（见 `blue_whale_web/package.json` 的 `lint-staged` 字段）：
   - `**/*.{ts,tsx,js,jsx,mjs}`：先 `prettier --write` 再 `eslint --fix`
   - `**/*.{css,md,json}`：只跑 `prettier --write`
3. lint-staged 自动 `git add` 修改后的文件（你重 commit 时看到的是修后版本）
4. lint-staged 失败（lint error 无法自动修）→ pre-commit 硬拦，exit 1
5. 紧接着跑 `pnpm --filter @blue-whale/web lint` 兜底；如有累积 warning 仅软提醒，不拦

### Prettier 配置

`blue_whale_web/.prettierrc`：

```json
{
  "semi": true,
  "singleQuote": false,
  "jsxSingleQuote": false,
  "tabWidth": 2,
  "useTabs": false,
  "trailingComma": "all",
  "printWidth": 80,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

调整后跑一次 `pnpm --filter @blue-whale/web format` 全量格式化前端，再用 `pnpm --filter @blue-whale/web format:check` 校验。

### Prettier 跳过

`blue_whale_web/.prettierignore` 跳过：

- 生成物：`node_modules/`、`.next/`、`out/`、`build/`、`dist/`、`.tsbuildinfo`、`next-env.d.ts`
- patch-package 维护的 `patches/`
- DESIGN v2 diff（设计系统升级专用产物）
- `graphify-out/`、`.codex/`（本地产物，均不入库）

## 手动跑

不通过 hook，直接在 shell 里跑：

```bash
pnpm --filter @blue-whale/web format         # 格式化前端
pnpm --filter @blue-whale/web format:check   # 仅校验，CI 用
pnpm --filter @blue-whale/web lint:fix       # 全量 eslint --fix（不只是 staged 文件）
pnpm --filter @blue-whale/web lint           # 全量 eslint 检查（兜底用）
```

## CI 集成（暂未做）

IJZYVJ acceptance 不含 CI 集成。当前 `pnpm --filter @blue-whale/web format:check` + `pnpm --filter @blue-whale/web lint` 可直接接入。后续 CI 工单独立开（参考 [ARCH-8 IJZYVT Playwright E2E](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IJZYVT) 的 CI 联动计划）。

## 为什么不用 husky

IJZYVJ issue 文字提到"装 husky + lint-staged"。实际实施**不引 husky**，原因：

- 仓库已有 `scripts/setup-hooks.sh` + `.githooks/` 体系，`git config core.hooksPath = .githooks` 已在 setup 时设置
- git 的 `core.hooksPath` 只能指向一个目录；装 husky 到 `.husky/` 会**要么**丢掉 `.githooks/`（graphify 自动重建、push 拦截、commit-msg 规范等钩子失效）**要么** husky 装而不生效
- 同一目标"pre-commit 跑 prettier + eslint --fix on staged files"用 lint-staged 直接挂到现有 `.githooks/pre-commit` 即可满足，少一层抽象

如果未来 husky 真正有用（比如要在 front/back 分别维护钩子），那是独立架构变更，需先重构 `.githooks/` 体系再讨论。

## 故障排查

| 现象 | 原因 | 修法 |
|---|---|---|
| pre-commit 报 `lint-staged: command not found` | 当前 worktree 没装依赖 | 在 worktree 根运行 `pnpm install --frozen-lockfile`（worktree 与主 checkout 共享 `.git`，但 `node_modules` 独立） |
| pre-commit 报 ESLint 错误拦截 | 你的代码有 lint error，`--fix` 修不了 | hook 失败时会透传 lint-staged 全部输出到 stderr，按提示修复后重 commit |
| 改了 .prettierrc 但守门没生效 | hook 读取根 lint-staged 配置并调用 prettier | `pnpm --filter @blue-whale/web format` 全量重格式化 |
| 想绕过守门应急 | 仅紧急情况 | `git commit --no-verify`，并在 commit message 注明原因 |
| lint 通过但 stderr 有 ⚠️ warning | `pnpm --filter @blue-whale/web lint` 兜底软提醒 | 警告也可能要修（如 unused var），不要忽略；改完再 commit |
