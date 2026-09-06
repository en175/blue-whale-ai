# Prompt 预览应用契约（IKDLQE）

## 时间

2026-09-06

## 目标与边界

落实 IKDL9U 的第一切片：手动应用一个预览为普通文本节点。复用现行 NestJS Canvas API、Prisma 的 canvas JSON 和版本锁；不引入第二套文本资源、生成任务或连线执行。

## 预览来源

来源为 `{ sessionId, revisionId, shotNo }`，作用域为当前项目。前端从独立 Agent 已提交的会话快照取得来源，不用标题、当前时间或数组下标替代。服务端按可信用户与项目上下文读取同一快照，匹配 `active_revision.revision_id` 和 `payload.shots[].shot_no`，只使用 `title` 与 `prompt_text`；`frame_description` 不作为正文或兜底。预览只读，修改通过继续对话形成新的修订。

已检查独立 Agent 当前源代码及路由清单：可用入口为 `GET /v1/projects/{projectId}/sessions/{sessionId}/snapshot`，没有文档提及的历史修订读取路由。从未应用且不可读取的历史修订返回明确错误；首次应用后保留可信正文快照，重复应用及删除后重建均无需依赖 Agent 在线。此适配不声称外部 Agent 已发布新的单正文协议。

## 应用与保存

`POST /api/canvases/{projectId}/prompt-previews/apply` 接收 `{ source, position: {x,y} }`，不接收客户端正文。成功信封的 data 为 `{ node, canvas, reused }`。节点为普通 `textNode`，data 为 `{ title, text, promptSource }`，其中 `text` 是纯文本权威正文。

在最新画布中按来源三元组查找；找到即返回原节点（包含独立编辑后的内容）。否则由服务端生成随机新节点 ID，通过 Canvas 条件写入追加节点。并发版本冲突重读重算，最多五次，竞争未解除返回 409 供用户重试。删除通过既有完整 Canvas PUT 移除节点，移除当前应用关系；再次应用从首次应用的可信快照创建新 ID，不恢复旧连线。

Canvas PUT 对预览来源作唯一性和不变性校验；客户端不能伪造来源或复制一个来源形成多个有效结果。带预览节点的保存必须带 If-Match。应用前前端等待正在进行的保存并保存当前编辑；应用期间串行化画布写入。冲突或保存失败保留当前编辑，不用服务器旧内容覆盖草稿。

新增 `prompt_preview_snapshots` 保存首次应用的只读来源快照：项目与来源三元组的 SHA-256 摘要共同唯一，保存来源 JSON、标题和原始正文。并发只接受首个快照，后续画布编辑不写回此表；这不是第二套可编辑文本资源。发布前执行 Prisma migration `20260906000000_ikdlqe_prompt_preview_snapshots`（与 schema/015 SQL 同步）。

## 限长

纯文本正文上限 100,000 UTF-16 code units，标题上限 200；完整 Canvas nodes JSON 上限 4 MiB UTF-8。前后端均使用同一份限长数据。该限制是持久化限制，不代表媒体模型输入上限。

允许范围内完整保存读取。超限拒绝保存并保留本地原文，编辑器不截断载入内容或粘贴内容。旧 HTML 节点继续兼容显示；预览应用产生的普通文本节点以实际文本编辑和传递，不将 HTML 当正文。

## 验证

测试边界沿用母规格确认的真实浏览器与公开业务 API。API 使用本地隔离 MySQL；仅外部 Agent 使用记录请求的替身。验证并发、重复、删除后重建、不同修订独立、项目归属、完整正文和超限零写入。认证会话装配与外部 Agent 线上联调范围单独记录。

集成测试直接挂载生产 Canvas/Project 控制器和服务、Prisma/MySQL、Agent BFF，认证中间件提供已登录用户身份，未覆盖真实登录/鉴权中间件。只读模型、用量、账号等外围 API 未挂载，其 404 不属于本次主链路证据；外部 Agent 的快照/SSE 使用记录可信用户与项目请求的替身，尚未以真实独立 Agent 部署完成联调。

复现命令：`IKDLQE_BROWSER=1 IKDLQE_DATABASE_URL=mysql://root@127.0.0.1:23306/ikdlqe pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/prompt-preview.integration.test.ts`。数据库必须是预先应用当前 Prisma schema 的隔离测试库，测试创建独立项目，不清理其他项目。
