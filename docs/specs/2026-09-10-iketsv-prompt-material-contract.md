# 带素材 Prompt 预览应用契约（IKETSV）

## 时间

2026-09-10

## 目标与依据

承接 IKE5G8 规格评论 51160751 的第一纵向切片。沿用 IKDLQE 的来源三元组、可信服务端读取、不可变预览快照和 Canvas 版本锁。应用只创建方案与必要素材节点，不创建生成目标或任务。

## Agent 到业务 API

保留 `payload.target_media`、`shots[].shot_no`、`title`、`prompt_text`、`asset_bindings[].asset_ref_id` 和 `assets[].{asset_ref_id,asset_id,media_type}`。素材身份仅从同一可信修订的 provenance 解析，媒体类型允许 image、video、audio。

每个 shot 增加 `prompt_mentions: Array<{start:number,end:number,asset_ref_id:string,index:number}>`。start/end 是原始 prompt_text 的 UTF-16 半开区间；index 是该标签固定的正整数展示编号。区间必须非空、不重叠、在正文范围内，并指向本 shot 已声明的绑定；相同编号不得代表不同素材。文本不被改写；同一素材可出现多次。旧纯文字方案可省略此字段；带绑定而没有显式标签定位的旧预览应明确拒绝并提示重新生成，不按素材名猜测定位。

可选 `time_range:{start:string,end:string}` 只表达作者明确给出的单一起止时间（HH:MM:SS 或 MM:SS），不得从 duration_seconds 推算。应用标题为 IMAGE 或 VIDEO #shot_no 加明确区间；无 target_media 的旧纯文字快照沿用旧标题。Agent 描述性标题保存为只读来源元数据，不覆盖原始正文。

## 画布与应用结果

POST 输入仍仅接收 `{source,position}`。方案 data 保存 `text` 及 `promptMentions`（区间、固定 index、assetId），`promptMaterials`（assetId、mediaType、url 与显示信息）和来源元数据。text 是唯一可编辑正文；标签身份与编号独立于其位置，文字编辑后由编辑器重新序列化区间。业务 API 校验标签身份只取自该方案可信素材集合，不接受新增或改写可信绑定。

同一资产以 assetId 精确复用 mediaNode，兼容 asset_id/assetID。已有重复卡不清理、不合并、不改变归属；已有同一素材即不补卡。新素材卡沿用该资产 ID，不复制资产字节或创建新资产身份。新增素材的项目关联与方案、素材节点在同一事务中提交。响应沿用 `{node,canvas,reused}`，canvas 提供完整可回读节点集合。

应用先检查全部素材归属、存在性和类型，失败指出标签编号且整次零新增。事务内再次锁定并检查素材，避免校验后删除造成残缺应用。Canvas CAS 冲突重读重算，最多五次；不可变预览快照存完整来源元数据，删除方案后重新应用仍可恢复同一原文与绑定。旧快照不猜测补绑定。

## 验证边界

复用已确认的真实浏览器→公开业务 API→隔离 MySQL；外部 Agent 使用记录式替身。公开 API 补充并发、越权、伪造、回滚与重试验证。真实 Agent 契约输出与联调单独记录，替身通过不代表跨服务交付。

## 实施前调查

当前 Agent V3 已保证 shot_no 连续、素材 provenance 从已接受素材目录复制；当前 audio 被排除，prompt_mentions/time_range 尚未提供。上述新增字段需要独立 Agent 生产端配套，不能仅修改消费端后宣称全链路完成。
