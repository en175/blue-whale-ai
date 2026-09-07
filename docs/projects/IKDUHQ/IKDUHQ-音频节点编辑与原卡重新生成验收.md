# 音频节点编辑与原卡重新生成验收

## 时间

2026-09-07

## 背景与范围

[IKDUHQ](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IKDUHQ) 属于 IKDQW7，基于已合入图片与视频切片的 `c236f0cf`。复用节点持久化、任务冻结、原卡结果承接及取消机制，补齐音频面板的模型恢复、保存失败禁发、提交等待只读和显式隐藏保护。音频实际支持的编辑配置仅为提示词与模型，不增加参考素材、时长控件或提示词历史。

## 行为与验证入口

| 场景 | 可观察结果 |
| --- | --- |
| 编辑与跨媒体恢复 | Enter 换行且不提交；图片、视频与音频各自保留最新编辑；空白、多选及上传音频隐藏面板；刷新和重新进入恢复提示词与模型 |
| 模型失效 | 原模型不被自动替换或写回；持续提示并禁发，用户选择可用模型后恢复 |
| 保存故障 | 保留未保存内容，暂停目标、发送和项目切换；允许隐藏重开与重试；保存成功恢复操作 |
| 提交等待 | 保存期间输入、模型及发送只读；隐藏重开仍只读；一次点击只接纳一个单结果任务 |
| 原卡结果 | 实际 worker 执行成功、失败、queued 取消；旧音频可播放，成功替换，失败和取消保留；身份、位置、连线、最新编辑和刷新结果一致 |
| 条件保存与冻结 | 旧版本保存返回 412；接纳后公开 API 更新编辑不改变供应商收到的任务输入；原任务和原音频仍可读取 |

主入口：`backend/apps/blue-whale/src/api/canvases/audio-regeneration.integration.test.ts`，共 8 个用例。Chromium → 生产 Canvas／生成／任务 API → 独立 MySQL 与 Redis → 实际 `processAudioJobById`、仓储、资产转存 HTTP 与供应商接口替身。跨媒体数据由实际图片／视频执行链生成。故障和保存等待在公开 HTTP 层控制；不模拟内部 Canvas 保存或直接写任务终态。

已用真实浏览器复现模型静默回退、保存等待可重复发送、保存失败按钮仍可用、空白隐藏后迟到选中事件重新打开面板四个缺陷，再逐项修复并通过用例。8 个音频集成用例完整执行通过，未跳过。

## 自动验证与审查结果

- 音频真实浏览器／API 集成：8 项通过；图片与视频原卡重新生成真实链路回归：17 项通过，均使用本任务隔离存储与供应商替身。
- Web 聚焦回归：51 项通过；Web 与 backend 类型检查通过。仓库选择器另按实际影响面执行 scoped 验证，结果通过；最终凭证以当前干净 HEAD 的 `check --json` 为准。
- 双轴代码审查：Standards 未发现需修复的规范问题；Spec 未发现可确认的需求偏离。两轴均明确保留人工页面验收，不把自动化结果当作人验完成。

## 复现

准备独立 MySQL `127.0.0.1:28306/ikduhq`、独立 Redis `127.0.0.1:28379`，应用 Prisma schema，安装工作区与 web 依赖、生成 Prisma 客户端并构建 Node packages。在任务 worktree 根运行：

```sh
IKDUHQ_DATABASE_URL=mysql://root@127.0.0.1:28306/ikduhq IKDUHQ_REDIS_PORT=28379 IKDUHQ_BROWSER=1 pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/audio-regeneration.integration.test.ts
```

未配置数据库变量时整组跳过；未配置浏览器变量时仅执行公开 API 用例。跳过不算功能验收通过。仓库收口另由 `verify-change-scope.mjs plan/run/check` 按干净 HEAD 生成验证凭证。

## 验收边界

供应商替身返回本地生成的 MP3；资产转存执行真实 HTTP PUT，存储授权与公开地址由本地对象存储适配替身提供，不验证 TOS。任务正常进入独立 Redis 队列，测试按接纳的 job ID 唤醒真实 worker，不验证 RocketMQ 传输。登录身份由测试装配注入，不覆盖鉴权。未调用付费供应商或使用共享数据库。

音频沿用软取消：queued 取消后由 worker 收敛为 cancelled，未派发供应商。此次不改变 processing 取消与成功竞态规则，也不承诺物理停止供应商或退款。

人工页面验收尚待用户完成。人工步骤：选中生成音频，修改提示词和模型，点击空白后重选，再手动发送并观察原卡；刷新确认配置与连线。代码交付停在本地任务 commit，不包含合入 master、远程发布、PR 或部署，不修改或关闭父需求。
