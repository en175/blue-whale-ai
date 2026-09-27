# IKFXLI 参考栏缩略图三态交互三缺陷修复实施记录

- 父规格单：IKFXLI【前端】附件索引素材缩略图三态交互升级 测试报告
- 目标发布线：release/2026.09.29
- 集成分支：fix/IKFXLI-三态交互三缺陷修复
- 起点 SHA：94282bda908534d56d875b1743734170a1c1aecb
- 日期：2026-09-27

## 背景

IKFXLI 测试报告（59 用例，54 通过 / 4 不通过）对参考栏附件索引素材三态交互升级的回归验证发现 3 个缺陷，均为对照父需求 IKFCJG 规格的偏差，已核验存在于 release/2026.09.29 发布线代码。根因定位与规格依据见 IKFXLI 的 Agent Brief 评论（评论 ID 51381515）。

## 任务图

```text
IKFXLI（集成容器，本 PR）
├── IKIQ88 缩略图 @ 按钮引用插入提示词光标处（图片/视频面板）   ← 无阻塞
├── IKIQ89 缩略图放大预览浮层在拖拽开始与滚动参考栏时关闭         ← 无阻塞
└── IKIQ8B 两位数编号圆钮加宽为胶囊形                             ← Blocked by IKIQ89（同改 RefThumbnail）
```

- IKIQ88 与 IKIQ89 文件集不相交，并行开发。
- IKIQ8B 与 IKIQ89 同改共享组件 RefThumbnail，按 Blocked by 声明串行在 IKIQ89 合入之后开工。

## 缺陷与验收依据

| 缺陷 | 子单 | 根因摘要 | 验收依据 |
| --- | --- | --- | --- |
| 问题 3（中高）@ 按钮插入落在文本末尾 | IKIQ88 | ImageDialog/BottomDialog 的 @ 回调调用 insertRefAtPending 未传 atCurrentSelection，永远兜底追加末尾；音频面板 AudioPromptEditor 为正确先例 | 子单验收标准 6 条，含 prompt-ref 集成测试覆盖「有光标原位插入 / 无光标追加末尾」 |
| 问题 2（低–中）预览浮层拖拽/滚动不关闭 | IKIQ89 | 预览关闭唯一路径是 handleMouseLeave，HTML5 拖拽开始后浏览器不再派发鼠标事件；strip-dnd 拖拽状态机未与预览状态联动 | 子单验收标准 6 条，含 RefThumbnail 组件级测试覆盖「拖拽开始关闭」「滚动关闭」 |
| 问题 1（低）两位数圆钮未加宽 | IKIQ8B | .badge 水平 padding 过小，「10」仅比一位数宽 1–2px | 子单验收标准 4 条；视觉不在单测断言像素，留浏览器复测 TC_REF_DEF_004（复测须显式确认第 1–9 号圆钮保持正圆：0 5px padding 下一位数宽度取决于字体渲染，存在失圆风险） |

## 范围边界

报告末尾「需求缺口与待确认」7 项属于产品决策，不纳入本次修复范围。

## 实施流程

implement-spec 集成模式：每个子单独立 worktree 开发、定向测试、提交，经 merge-implement-spec-child 合入本集成分支；全部合入后跑收口与 PR 阶段验证（verify-change-scope --stage pr）与代码评审。各子单的验证证据见其工单与提交说明。
