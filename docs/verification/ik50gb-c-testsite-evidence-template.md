# IK50GB-C 测试站 HTTP 验收证据

- 日期：
- 测试站：
- Git commit：
- 执行人：
- `BW_TEST_REGISTER`：`0` / `1`
- `BW_ALLOW_BILLED_MEDIA_PROBE`：`0` / `1`

## 安全边界

- 仅调用 BlueWhale HTTPS 接口。
- 未使用 MySQL、Redis、迁移、seed、容器清理或删除接口。
- 用户名、密码、`sk-xxx`、Authorization、Cookie 与上游响应体不写入证据。
- 图片/视频调用仅在获得明确计费授权后启用。

## 脱敏结果

```text
POST /api/auth/register                       （可选）
POST /api/auth/login
GET  /api/me
GET  /api/usage/token
POST /api/projects
POST /api/projects/:id/conversation/messages
POST /api/projects/:id/generation-jobs (image)（需授权）
POST /api/projects/:id/generation-jobs (video)（需授权）
GET  /api/jobs?ids=...（等待 image/video 均为 succeeded，需授权）
GET  /api/usage/token（记录脱敏 quota delta，需授权）
IK50GB-C test-site probe
```

## 结论

- [ ] HTTP-only 账户与产品链路通过
- [ ] 图片链路通过（如获授权）
- [ ] 视频链路通过（如获授权）
- [ ] 图片/视频任务均到达 `succeeded`，且 quota 未反向增加（如获授权）
- [ ] 输出经人工复核不含凭证
