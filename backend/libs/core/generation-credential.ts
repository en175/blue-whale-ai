// 修正四（2026-09-12）：生成凭证去密。
// Redis 会话 sealedSk 与 job.input.provider_credential 均改明文，
// AES-GCM 密封/解封链路与 GENERATION_CREDENTIAL_SECRET 依赖整体删除。
// 本文件保留为契约记录；实现由调用方以明文直通替代（session/credential/worker 已就地改）。
export {};
