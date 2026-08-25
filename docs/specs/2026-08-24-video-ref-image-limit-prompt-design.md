# 视频参考图超限前端提示 + 模型能力配置对齐设计

- 日期：2026-08-24
- 状态：待评审
- 范围：web.master.xfai.cloud 视频生成入口（首页 ChatBox 视频tab + 画布 BottomDialog）在用户上传参考图超过对应模型限量时提示「减少图片」；同时把已接入的 2.0 视频模型 `features.max_reference_images` 配置对齐 Seedance 官方上限（9）。参考前序工单 IKA72G（后端参考图上限读模型能力配置）。

## 背景与目标

IKA72G 之后，后端 image 参考图上限已改为读模型能力配置（`features.max_reference_images`，缺省兜底 10，与网关 `maxImageEditImages=10` / ARK Seedream 复合编辑对齐），字段语义统一（image=`input_asset_ids`、video=`reference_asset_ids`、首尾帧=独立字段）。前端也已读接口下发的 `max_reference_images`，但**超限上传被静默截断、无任何提示**——用户多选图片超出模型限量时，多余的被悄悄丢弃，用户不知道为什么少了几张。

同时发现配置缺口：已接入的三个 Seedance 2.0 视频模型在测试库均**未配置 `max_reference_images`**（NULL → 兜底 10），而 Seedance 官方多模态参考图上限是 **9 张**（1~9）。兜底 10 已超官方口径——前端/后端放行 10 张，ARK 会拒。需把三兄弟配成 9，并让前端在超限时明确提示。

## 需求澄清结论

| 维度 | 决定 |
| --- | --- |
| 提示范围 | 首页 ChatBox 视频tab + 画布 BottomDialog 视频弹窗（两处参考图上传行为对齐） |
| 提示行为 | toast + 保留上限内（方案 A）：多选超出时保留前 N 张，并 toast 提示用户减少；已达上限时点上传按钮也 toast，不再静默无反应 |
| 配置修正 | 三个 2.0 视频模型 `features.max_reference_images` 直接 SQL 设为 9（JSON_SET，可逆） |
| seedance-2.0-ep | 用户已在后台软删（is_delete=1），不参与；纯文生视频模型后续如启用需单独评估参考图入口 |
| 后端校验 | 维持现状（video reference_asset_ids ≤12 兜底；9图+3视频=12 恰好一致），本工单不改后端 |

## 现状（各层限制与代码位置）

### 测试库视频模型配置（2026-08-24 实测）

| model_id | model_label | enabled | max_reference_images | reference_image | 首尾帧 |
| --- | --- | --- | --- | --- | --- |
| doubao-seedance-2-0-260128 | Seedance 2.0 | 1 | NULL（→兜底10） | true | true |
| doubao-seedance-2-0-fast-260128 | Seedance 2.0 Fast | 1 | NULL（→兜底10） | true | true |
| doubao-seedance-2-0-mini-260615 | Seedance 2.0 Mini | 1 | NULL（→兜底10） | true | true |
| seedance-2.0-ep | seedance-2.0-ep | 1 | NULL | NULL | NULL |

`seedance-2.0-ep` 已 `is_delete=1`（后台软删）。Seedance 官方多模态参考图上限 **1~9 张**（调研文档 `docs/research/2026-07-29-seedance-video-reference-inputs.md`）。

### 前端（均已读 max_reference_images，但超限静默截断）

- 首页 ChatBox 视频tab：`web/src/pages/Home/components/ChatBox/index.tsx`
  - `:488-502` `videoMaxImages = videoMode==='firstlast' ? 2 : (features?.max_reference_images ?? 10)`；`MAX_VIDEOS=3`
  - `:504-527` `handleRefFiles` 按剩余名额 `filter` 静默丢弃超限文件，**无提示**
  - `:619` placeholder 已显示「图片最多 N 张 / 视频最多 3 个」（读同一变量，配置修正后自动变 9）
- 画布 BottomDialog：`web/src/pages/CanvasPage/components/BottomDialog/index.tsx`
  - `:143` `maxImages = isKeyframe ? 2 : (currentModel?.features?.max_reference_images ?? 10)`；`MAX_VIDEOS=3`
  - `:227-236` `handleImageClick`/`handleVideoClick` 达上限时静默不开选择器，**无提示**
  - `:300-333` `addFiles` 按剩余名额 `slice` 静默截断，**无提示**
  - `:195-205` `externalImagePick`（画布节点带入图片）达上限静默 return，**无提示**

### 后端（IKA72G 已落地，本工单不动）

- `handle-create-generation-job.ts:188-209`：image 参考图上限 = `capability?.features?.max_reference_images ?? DEFAULT_MAX_REFERENCE_IMAGES(10)`；video 走 `reference_asset_ids ≤12` / `input_asset_ids ≤1` 校验
- `packages/persistence/src/model-capability-repo.ts:11` `DEFAULT_MAX_REFERENCE_IMAGES = 10`（image 兜底口径，与网关/ARK 对齐）

## 配置修正（直接 SQL，需批准后执行）

三个 2.0 模型 `features` 增加 `max_reference_images: 9`：

```sql
UPDATE generation_model_capability
SET features = JSON_SET(features, '$.max_reference_images', 9)
WHERE capability_type = 'video'
  AND is_delete = 0
  AND model_id IN (
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-0-mini-260615'
  );
```

- 还原：`JSON_REMOVE(features, '$.max_reference_images')` → 回兜底 10
- 执行方式：起 SSH 隧道（`scripts/tunnel-testsite-db.sh` / CLAUDE.md 记录的应急通道）→ mysql 执行
- 验证：`/api/generation/models?capability=video` 三兄弟 `max_reference_images=9`；前端 placeholder 自动变「图片最多 9 张」

## 前端改动（方案 A：就地加 toast）

两处文件各自在超限截断点补 `showToast`，不动现有结构：

### 1. 首页 ChatBox 视频tab（`ChatBox/index.tsx`）

- `handleRefFiles`（`:504-527`）：计算 `files.length - newFiles.length` 的丢弃数，按类型归因——
  - 图片被丢弃（`imgRoom` 不足）→ toast「参考图最多 N 张，请减少图片」（N = videoMaxImages）
  - 视频被丢弃（`vidRoom` 不足）→ toast「参考视频最多 3 个」
  - 全部被丢弃（已满且只选图片/视频）→ 同上归因提示
- 复用现有 `showToast`（`:170`）

### 2. 画布 BottomDialog（`BottomDialog/index.tsx`）

- `addFiles`（`:300-333`）：`list.length < all.length` 时按类型归因 toast（同上文案；`maxImages` 首尾帧模式为 2）
- `handleImageClick`/`handleVideoClick`（`:227-236`）：达上限时 toast「参考图最多 N 张，请减少图片」/「参考视频最多 3 个」，不再静默
- `externalImagePick` effect（`:195-205`）：`imgCount >= maxImages` 达限时 toast（首尾帧模式同样适用）
- 复用现有 `showToast`（`:117-121`）

### toast 文案（对齐后端「参考图最多 N 张」口径）

- 图片超限：`参考图最多 ${N} 张，请减少图片`
- 视频超限：`参考视频最多 3 个`
- 首尾帧模式沿用现有「首尾帧模式需上传两张图片作为首帧与尾帧参考」/「首尾帧模式需要上传首帧和尾帧两张图片」

## 不做的事（YAGNI）

- 不改后端校验（video 12 上限已兜底，且 9图+3视频=12 一致）
- 不改 `DEFAULT_MAX_REFERENCE_IMAGES=10`（image 兜底口径，与网关/ARK 对齐；视频模型应各自显式配 9）
- 不动 AI图片tab（ChatBox 图片tab）/ 画布 ImageDialog（图片生成参考图）——本次范围限定视频入口，图片侧如需统一提示另开工单
- 不改 `seedance-2.0-ep`（已软删）

## 验证

1. **配置**：SQL 执行后回读三兄弟 `max_reference_images=9`；`GET /api/generation/models?capability=video` 下发 9
2. **前端手动**（首页 ChatBox 视频tab + 画布 BottomDialog）：
   - 全能参考模式上传 >N 张图片 → 只保留前 N 张 + toast「参考图最多 N 张，请减少图片」
   - 上传 >3 个视频 → 只保留前 3 个 + toast「参考视频最多 3 个」
   - 已达上限点上传按钮 → toast 提示
   - 首尾帧模式行为不变
3. **回归**：多选未超限正常加入、无 toast；画布节点带入图片正常

## 关联

- IKA72G（后端参考图上限读模型能力配置，本工单沿用其口径）
- IKA715（前端上传入口溢出 + 前端上限对齐，本工单在前序基础上补提示）
- IK6PA5（前端 atReferenceLimit 语义，max_reference_images 为 0 时不能兜底）
