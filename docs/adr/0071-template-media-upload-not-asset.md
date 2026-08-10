# 模板媒体上传不进 Asset 模型

管理后台为模板卡片上传图片/视频时走独立的 admin 上传端点（presign → 浏览器直传 TOS → complete 置 public-read），复用画布的 TOS 存储适配器但不创建 Asset 行。按领域定义，Asset 必须归属 Project、是 User 的产品资源；而模板媒体是平台级内容，生命周期必须独立于任何员工账号——照搬画布链路需要伪造管理员 Project，并使首页媒体受该账号存亡牵连。媒体最终以纯 URL 字符串存于 template_card.video_url / template_card_image.image_url 既有字段，对象位于 admin/templates/ 前缀、public-read，孤儿对象不自动清理（软删可恢复语义优先）。

## Considered Options

- **整套复用画布上传链路（含 Asset 落库）**：需伪造归属 Project，污染 Asset 领域语义，媒体生命周期与管理员账号耦合——否决。
- **直接复用画布端点（管理员以普通登录态上传）**：零后端改动，但同样产生归属个人 Project 的 Asset，首页内容挂在员工账号下——否决。
- **服务端中转上传（route handler 收文件转存 TOS）**：200MB 视频压 Next.js route handler（内存 / body 上限 / 超时风险），且失去浏览器直传的进度能力——否决。