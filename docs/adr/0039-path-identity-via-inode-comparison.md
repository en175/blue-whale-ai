# ADR-0039：路径身份判定一律走 inode（samefile），禁跨来源字面串比较

- **状态**：Accepted
- **日期**：2026-07-20
- **决策者**：JJNNReno（与 Claude 经 `/grill-with-docs` 会话共同得出）

## 背景

2026-07-20，IK2BCH T6.1 实施第一步被 `scripts/start-task-worktree.sh` 唯一入口误拦，
全部可写任务零启动。根因：macOS APFS（大小写不敏感、大小写保留）上，session cwd
拼写为 `/Users/kimjohn/blue-whale-ai`（小写），而 `git rev-parse --show-toplevel`
经 getcwd 返回磁盘规范形式 `/Users/kimjohn/Blue-Whale-AI`（大写）。
`ensure_primary_master()` 对两个**独立来源**的路径做字符串相等比较，同一物理目录
被判「不同目录」。

## 决策

凡判定「两个路径是否同一目录」，一律用 inode 判等（Python `os.path.samefile`），
禁止跨来源字面串比较。两个来源的大小写语义本就不同：git 输出走 getcwd（磁盘规范
形式），shell `pwd` / `BASH_SOURCE` 推导走逻辑 PWD（调用者拼写）。

入口 bash 包装脚本同步把 `pwd` 改为 `pwd -P` 取物理路径，让规范拼写成为常态，
samefile 退为兜底。

单来源比较（路径与其自身推导物相比，如 ROOT 与从 ROOT 算出的 WORKTREE_BASE）
不受此约束——同源同拼写，天然一致。

## 否决项

- **`os.path.realpath` / `Path.resolve()`**：大小写保留的 APFS 上保留输入大小写，
  换用它们不能修复。这是最直觉也最错的改法，实测验证无效（小写进、小写出）。
- **`str.casefold()` 等大小写归一后比较**：在大小写敏感 FS（Linux）上会把仅大小写
  不同的两个真实不同目录误判为相同，放行方向出错。
- **入口先 `cd` 规范化 cwd**：改不了 Python `__file__` 推导，对绕过包装直调 `.py`
  无效，效果被 `pwd -P` 完全覆盖。

## 后果

- 主 checkout 任意拼写调用入口均正确放行；task worktree 内偷跑仍被拦（物理就是
  不同目录，inode 不同），守卫语义从「拼写一致」回归设计意图「同一物理目录」。
- `samefile` 在路径不存在时抛 `OSError`；本守卫两个输入（脚本自身位置、git 报告
  的仓库根）必然存在，不加防御性处理。
- Windows NTFS（大小写不敏感）由同一实现天然覆盖，无需另验。
- 同类审计结论：全仓仅 `ensure_primary_master` 一处跨来源比较。其余
  `rev-parse --show-toplevel` 用法（publish / commit / cleanup / ensure-graphify /
  sync-superpowers / merge / sync-task-from-origin / pr-update-evidence 等脚本与
  hooks）均为单来源取根或比对命令模板字面文本，确认安全，无需改动。
- 回归锁定：`scripts/test-hooks.sh` Slice 8 从小写拼写路径调沙箱入口，断言守卫
  不拦；大小写敏感 FS（Linux）自动跳过。
- 术语「规范路径 / 逻辑路径」已入 `CONTEXT.md`「Agent 协作语言」。
