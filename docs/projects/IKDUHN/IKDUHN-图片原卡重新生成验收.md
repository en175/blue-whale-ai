# 图片原卡重新生成验收

## 时间

2026-09-07

## 背景与范围

[IKDUHN](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IKDUHN) 属于 IKDQW7，基于已合入的 IKDUHM。复用原卡发送、输入快照和结果回填，补齐刷新期间旧素材地址恢复、提交期间迟到响应防线及图片取消执行闭环。用户已在本次实现会话授权后端／持久化补齐。

## 行为与验证

| 场景 | 公开可观察结果 |
| --- | --- |
| 编辑、Enter、保存 | 最新编辑持久化，不创建任务；保存失败不提交，重试后可发送 |
| 原卡发送 | 历史多结果配置仍提交单结果；节点身份、位置、数量、连线保持 |
| 生成期间刷新 | 旧 Asset 重新解析有效地址；保留旧图片，配置只读 |
| 成功／失败／取消 | 成功只换当前素材；失败显示原因；失败／取消保留旧素材与最新编辑，刷新一致 |
| 下游引用 | 已提交任务使用旧快照，下一次手动发送使用替换后的素材；不自动生成，不改历史 Asset／任务 |
| 取消竞态 | queued 取消不再调用供应商；processing 取消拒绝迟到产物；已完成任务拒绝取消；旧取消响应不解除新提交的只读状态 |

主要入口：`backend/apps/blue-whale/src/api/canvases/image-regeneration.integration.test.ts`。使用真实 Chromium、Canvas／生成／任务 API、独立 MySQL、实际 `processImageJobById` 与持久化仓储。供应商通过生产接口注入替身，可记录输入及控制返回时机。保存故障与网络竞态只在公开 HTTP 边界控制；不直接写任务终态制造生成结果。

测试显式按已接纳 job ID 唤醒实际 worker，不验证 RocketMQ 传输。图片由本地 HTTP fixture 服务提供，资产写入独立数据库，不验证 TOS 上传。身份由测试装配注入，不覆盖登录鉴权；不连接共享生产／测试站数据库，不调用付费供应商。

## 复现

先为本工单准备独立 MySQL 并应用 Prisma schema，安装工作区和 web 依赖、生成 Prisma 客户端及构建 Node packages。将下面连接变量指向该独立库：

```sh
IKDUHN_DATABASE_URL=mysql://root@127.0.0.1:26306/ikduhn IKDUHN_BROWSER=1 pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/image-regeneration.integration.test.ts
```

未配置 `IKDUHN_DATABASE_URL` 时整组跳过；未配置 `IKDUHN_BROWSER` 时只运行公开 API 部分。跳过不算功能验收通过。仓库收口另外执行 `verify-change-scope.mjs plan/run/check`，其凭证绑定提交，不能用此说明代替。

## 取消语义

图片取消事务撤销 lease／fencing token，将任务收敛为 cancelled，结束 pending 输出槽并释放本地预留。供应商已开始的调用可能继续计费，`refund_unverified` 保留待核对语义；取消确认仅保证本任务不能再发布新结果，不声称供应商已物理中断或已退款。成功结算与取消争用同一任务行，先提交的终态获胜。视频／音频继续使用既有软取消。

## 人工验收与交付边界

自动化与人工验收分开记录。本次未获得人工页面验收结论，也未推送、开 PR、合并或部署。

人工复核步骤：选中已有生成图片，修改提示词并发送；确认原图在生成期间可见；分别观察成功替换及取消保留；刷新后检查原卡和连线；在下游卡手动发送确认使用新素材。
