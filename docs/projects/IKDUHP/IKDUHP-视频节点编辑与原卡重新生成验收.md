# 视频节点编辑与原卡重新生成验收

## 时间

2026-09-07

## 背景与范围

[IKDUHP](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IKDUHP) 属于 IKDQW7，基于已合入的 IKDUHN 和开工提交 `ed362654`。复用节点编辑保存、原卡任务接纳与结果回填，补齐视频配置恢复、Enter 换行、隐藏保护和不兼容输入提示。

## 行为与验证入口

| 场景 | 可观察结果 |
| --- | --- |
| 编辑与恢复 | 提示词、模型、比例、分辨率、时长持久化；Enter 换行且不创建任务；空白、多选及上传素材隐藏面板；图视频编辑独立 |
| 配置失效 | 已下线模型保留原配置并禁发送；不支持视频参考的模型明确提示，用户调整模型后才可发送，引用不被删除 |
| 保存故障与等待 | 保存失败阻止目标、发送、项目切换；允许隐藏并重开原目标；重试成功恢复操作；保存等待期间禁重复发送 |
| 原卡生成 | 发送前保存，提交单结果及真实时长、首尾帧和文本附件；生成中旧视频可见且只读；成功原位替换；失败和取消保留旧素材、最新编辑、身份、位置及连线，刷新一致 |
| 下游引用 | 已提交任务继续使用旧素材快照；下一次手动生成使用替换后的素材；不自动触发、不改已有任务产物 |
| 条件保存 | 旧版本请求返回 412，不能覆盖新提示词、时长和参考角色 |

入口：`backend/apps/blue-whale/src/api/canvases/video-regeneration.integration.test.ts`。实际 Chromium → 生产 Canvas／生成／任务 API → 独立 MySQL → 实际 `runVideoJobStep`、仓储与供应商接口替身。图片切换数据通过实际图片 worker 生成。生成终态由执行链落库，不直接写终态；故障和等待在公开 HTTP 层控制。

已接纳任务按 job ID 唤醒实际 worker，不验证 RocketMQ 传输。视频由本地 HTTP fixture 提供，媒体存储边界返回本地地址，不验证 TOS；登录身份由测试装配注入，不覆盖鉴权。不调用付费供应商或连接共享数据库。

## 复现

准备独立 MySQL、应用 Prisma schema，安装工作区与 web 依赖、生成 Prisma 客户端并构建 Node packages。在任务 worktree 根执行：

```sh
IKDUHP_DATABASE_URL=mysql://root@127.0.0.1:27306/ikduhp IKDUHP_BROWSER=1 pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/video-regeneration.integration.test.ts
```

未配置数据库变量整组跳过；未配置浏览器变量仅跑公开 API 用例。跳过不算功能验收通过。仓库收口另外执行 `verify-change-scope.mjs plan/run/check`，凭证绑定干净提交。

## 取消与人工验收边界

视频保留既有软取消语义：queued 取消请求确认后仍显示处理中，worker 收敛为 cancelled 后恢复编辑；processing 取消可能与成功竞态，不承诺供应商已物理停止或退款。此次自动化覆盖 queued 取消执行闭环，不改变视频后端取消机制。

人工页面验收尚待用户完成；没有推送、PR、合并或部署。人工复核入口：选中已有生成视频，修改提示词与时长，隐藏后重选，再发送并观察原卡更新；刷新确认配置与连线保持。
