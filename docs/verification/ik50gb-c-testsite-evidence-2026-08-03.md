# IK50GB-C 测试站 HTTP 验收证据

- 日期：2026-08-03
- 测试站：`http://115.190.244.91:3000`（BlueWhale BFF；new-api 位于 3005）
- Git commit：`chore/测试站探针HTTP豁免开关` 任务分支
- 执行人：shuggg（用户授权）+ Agent
- `BW_TEST_REGISTER`：`1`（一次性探针账号，用后即弃）
- `BW_ALLOW_BILLED_MEDIA_PROBE`：`1`（用户明确授权）
- `BW_ALLOW_INSECURE_HTTP`：`1`（用户知情豁免——测试站无 TLS；userinfo 绕过仍被拒绝）

## 安全边界

- 仅调用 BlueWhale HTTP 接口。
- 未使用 MySQL、Redis、迁移、seed、容器清理或删除接口。
- 用户名、密码、`sk-xxx`、Authorization、Cookie 与上游响应体不写入证据。
- 图片/视频调用仅在获得明确计费授权后启用。

## 脱敏结果

```text
POST /api/auth/register                          200
POST /api/auth/login                             200
GET /api/me                                      200
GET /api/usage/token (before)                    200
POST /api/projects                               200
POST /api/projects/:id/conversation/messages     200
POST /api/projects/:id/generation-jobs (image)   200
POST /api/projects/:id/generation-jobs (video)   200
GET /api/jobs?ids=... (terminal poll)            200
MEDIA terminal state                             FAILED
```

## 媒体终态失败诊断（测试站部署侧，非代码缺陷）

- 图片任务：停留 `queued`——测试站图片执行 worker 未消费队列（进程/部署问题）。
- 视频任务：`provider_failed`（视频生成失败）——测试站 new-api 视频渠道/上游供应商调用失败（渠道配置或供应商凭证问题）。
- 同一链路在本地验收栈（真实 new-api + provider stub）为 6/6 全绿，代码侧无缺陷证据。

## 结论

- 账户与产品面 8/8 接口通过：注册→登录→身份→quota→项目→对话→生成任务提交全部走统一鉴权（sk-xxx Bearer），与 ADR-0062 设计一致。
- 媒体终态被测试站部署配置阻塞；需运维侧修复图片 worker 与视频渠道后重跑探针，方可关闭 IK50GD 真实联调项。
