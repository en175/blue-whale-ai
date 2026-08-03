# IK50GD 测试站终验证据（探针 PASS）

- 日期：2026-08-03
- 测试站：`http://115.190.244.91:3000`（BlueWhale BFF；new-api 位于 3005）
- 执行人：shuggg（用户授权计费探针）+ Agent
- 账号：测试站既有 root 账号（quota 充足）；`BW_TEST_REGISTER=0`
- 开关：`BW_ALLOW_BILLED_MEDIA_PROBE=1`（用户明确授权）、`BW_ALLOW_INSECURE_HTTP=1`（用户知情豁免，测试站无 TLS）、`BW_PROBE_TERMINAL_TIMEOUT_SECONDS=600`

## 安全边界

- 仅调用 BlueWhale HTTP 接口；未使用 MySQL、Redis、迁移、seed、容器清理或删除接口。
- 凭据经 chmod 600 临时文件流转，输出经 `sanitize_acceptance_logs.py` 脱敏。

## 脱敏结果

```text
POST /api/auth/login                             200
GET /api/me                                      200
GET /api/usage/token (before)                    200
POST /api/projects                               200
POST /api/projects/:id/conversation/messages     200
POST /api/projects/:id/generation-jobs (image)   200
POST /api/projects/:id/generation-jobs (video)   200
GET /api/jobs?ids=... (terminal poll)            200
MEDIA terminal state                             succeeded
GET /api/usage/token (after)                     200
MEDIA quota delta                                421173（计费归属成立）
IK50GB-C test-site probe                         PASS
```

## IK50GD 验收标准达成情况

1. 移除旧手机号/refresh 语义：✅（旧链已删；SMS 换绑经用户拍板保留为产品功能）
2. 浏览器黑盒（注册自动登录/刷新恢复/logout/不直连 new-api）：✅（阶段一 smoke + 拓扑守卫）
3. 真实联调：✅ 本证据（图片/视频均 succeeded，quota delta 归属探针账号）
4. 回归套件：✅（typecheck 含 web --noEmit、web 1226、packages 107、Go 三包、探针契约 9/9）

## 备注

- 首轮探针媒体失败根因链已修复：外部连接打爆 MySQL（防火墙治理，IK65BP）→ 探针账号零额度（改用 root 账号）→ 等待窗口不足（超时改可配置）。
- 测试站仍运行 7/31 旧构建即已全绿；master 新代码重新部署后可随时复验。
