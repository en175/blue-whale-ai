# IK4QUV 前置缺口核对 + 技术方案

> 2026-07-28 创建 · 2026-07-29 重写（对接 IK4Q48 + 6 child 已建）
>
> 配套：[案例卡片 → canvas 衔接 IK4Q48](./2026-07-28-case-card-to-agent-flow-and-gaps.md)（管点生成 → 进 canvas 的衔接 + agent 接手边界）
>
> 本文管 IK4QUV「卡片前半段」：前置核对 + 数据模型建议 + 占位符方案。**canvas 内流程归 IK4Q48，本文不展开**。

## TL;DR

1. **两个前置都没真正就位**（工单状态有误导）：
   - **IK170R**（卡片点击回填）：前端已落地（IK171T 合并），**后端 `prompt` 字段没加**，前端回填的实际是 `card.title`。
   - **IK1565**（标签 enum→DB）：工单 closed 是**作废**，代码里 `TemplateTagEnum` 仍是唯一数据源 + `/page` 白名单，`template_tag` 表不存在。
2. **IK4QUV 不死等前置**：IK170R 前端链路可复用；IK1565 技术上可解耦（字段定义直接挂 `card.tag_code`）。
3. **IK170R 后端 `prompt` 列不单独补**——被 IK4QUV 的结构化字段模型吸收。
4. **IK4QUV 地基 = 后端结构化字段存储**（纯后端活，已拆 #IK4Z8D）。
5. **IK4QUV = 输入端**：只管首页案例卡片 → 点生成 → 进 canvas。canvas 内走 IK4Q48，**forced skill 取消**（见配套文档）。

---

## 一、前置核对（带代码证据，仍权威）

### IK170R — 卡片点击回填输入框

| 项 | spec 要求 | 代码实际 | 判定 |
|---|---|---|---|
| 实现落点 | — | 以 **IK171T** 合并（`664bca8a`，PR !165，在 master）| — |
| 后端 `template_card.prompt` 列 | 新增 VARCHAR nullable | 表只有 `tag_code/title/video_url/layout/sort_order` + 审计列，**无 prompt 列**（`V1__baseline.sql:6`、V5 字段统一也未加）| ❌ 没做 |
| DTO `prompt` 字段 | `TemplateCardDto` 加 `prompt` | DTO 只有 `title/video/images/layout` | ❌ 没做 |
| 前端受控化 | `AgentComposer` 加 `prompt?/onPromptChange?` | 已加（`AgentComposer.tsx:104-107`）| ✅ 落地 |
| 前端回填链路 | 卡片点击 → `onAppendPrompt` → `appendPrompt` | 已落地（`home-client.tsx:44`、`appendPrompt.ts`）| ✅ 落地 |
| **回填的内容** | 应是 `card.prompt` | `TemplateCardItem.tsx:34` → `onAppendPrompt?.(card.title)`，**回填的是 title** | ⚠️ 退而求其次 |

**结论**：IK170R = 🟡 **半落地**。前端骨架（受控输入框 + 回填链路 + appendPrompt 纯函数）可复用，但后端 prompt 字段缺失，回填的是 title。

### IK1565 — QuickTags 标签 enum → DB 表

| 项 | spec 要求 | 代码实际 | 判定 |
|---|---|---|---|
| `template_tag` 表 | 新建 | grep 全仓无此表 DDL | ❌ 不存在 |
| `listTags()` 数据源 | 改查 mapper | `TemplateServiceImpl.java:42` → `Arrays.stream(TemplateTagEnum.values())` 仍遍历 enum | ❌ 没改 |
| `/page` 白名单 | 改查 DB | `TemplateController.java:55` → `TemplateTagEnum.isValid(tagCode)` 仍用 enum | ❌ 没改 |
| closed 原因 | — | spec 自述「初版误判，子任务 IK158F/IK158J 已作废」| 作废关闭，非完成 |

**结论**：IK1565 = 🔴 **完全没落地**。标签数据源仍写死在 `TemplateTagEnum`（5 个：marketing/short/replicate/social/image）。

---

## 二、IK4QUV 范围（输入端）

IK4QUV 只管**首页案例卡片输入端**：点卡片 → 模板回填 → 换图 → 点生成 → 进 canvas。

- **canvas 内流程归 IK4Q48**（agent 对齐 → 计划卡 → 手动应用 → 场景卡 → 生成），IK4QUV 不定义。
- **forced skill 取消**：原「首次 forced skill 确定性直接生成」跟 IK4Q48 自由对齐流冲突（详见配套文档 + IK4QUV spec Decisions 13）。
- **案例卡片（首页，运营模板）≠ 场景卡（canvas，agent 产出的 Markdown 节点）**——两者接力。

---

## 三、数据模型建议（后端，归 #IK4Z8D 定）

### 现状

- `template_card`：`id, tag_code, title, video_url, layout, sort_order` + 审计列
- `template_card_image`：`card_id, image_url, sort_order`（卡片**展示图**，非占位符图）
- 5 个 tag_code 写死在 enum

### 推荐：字段定义表 + 字段值表（EAV 变体）

**为什么不加 JSON 列**：spec 要求「运营加字段不发版」。EAV 让「加字段 = 往 field_def 插一行」，真正运营自助。

```sql
-- 1) 字段定义：每类(tag_code)有哪些字段，运营可配
CREATE TABLE template_field_def (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  tag_code    VARCHAR(64)  NOT NULL COMMENT '所属类型，对齐 template_card.tag_code',
  field_key   VARCHAR(64)  NOT NULL COMMENT '字段键：product_category / ad_style ...',
  field_label VARCHAR(64)  NOT NULL COMMENT '展示名：产品类别 / 广告风格',
  field_type  VARCHAR(16)  NOT NULL COMMENT 'text / image_slot',
  sort_order  INT          NOT NULL DEFAULT 0,
  enabled     TINYINT      NOT NULL DEFAULT 1,
  gmt_create  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version     INT          NOT NULL DEFAULT 0,
  is_delete   TINYINT      NOT NULL DEFAULT 0,
  UNIQUE KEY uk_field_tag_key (tag_code, field_key),
  INDEX idx_field_tag (tag_code, sort_order)
);

-- 2) 字段值：每张卡片各字段的值
CREATE TABLE template_card_field_value (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  card_id      BIGINT       NOT NULL,
  field_def_id BIGINT       NOT NULL,
  field_value  VARCHAR(512) NULL COMMENT '文本值；image_slot 类型存用途名如"主产品图"',
  gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version      INT          NOT NULL DEFAULT 0,
  is_delete    TINYINT      NOT NULL DEFAULT 0,
  UNIQUE KEY uk_value_card_field (card_id, field_def_id),
  INDEX idx_value_card (card_id)
);
```

**占位符的存法**：
- `field_type = image_slot` 的字段，`field_value` 存**用途名**（如「主产品图」）
- 回填渲染：`field_label + "：" + (@[ + field_value + ])`
  - text → `广告风格：高端时尚电视广告`
  - image_slot → `产品图片：@[主产品图]`
- 用户上传的图**不进这两张表**——是用户会话态素材，只存在前端。回填时图位本就为空。

**回填文本拼装**（后端可预拼返给前端，或前端按结构拼）：
```
制作一部高端时尚的电视广告
产品类别：口红
产品图片：@[主产品图]
广告风格：高端时尚电视广告
节奏：快节奏
摄影技巧：多变的镜头角度、快速剪辑、动感过渡与旋转镜头
```

> ⚠️ 上述是**技术建议**，表结构 / 数据模型最终归 #IK4Z8D 后端定。

### DTO 形态（建议）

```java
public class TemplateCardDto {
    private String title;
    private String video;
    private List<String> images;
    private String layout;
    // 新增：结构化提示词（已拼好的回填文本，前端直接塞输入框）
    private String promptTemplate;
    // 新增：占位符用途名清单（前端渲染可点击插槽 + 绑定上传）
    private List<PromptSlot> slots;
}

public class PromptSlot {
    private String usage;      // "主产品图"
    private String fieldLabel; // "产品图片"
}
```

---

## 四、占位符交互方案（前端，归 #IK4Z8G 定）

### 现状可复用

- 输入框是 `contentEditable` 的 `<div>`（`editorRef`）
- 已有 `insertSkillIntoEditor`（`AgentComposer.tsx:401-426`）：Selection/Range 在光标位置插入 `@skillName` 文本节点 —— **占位符插入可复用这套 Range 机制**
- 受控 props 已就位（`prompt/onPromptChange`），`handleInput` 读 `editorRef.innerText`

### 推荐：`contenteditable=false` 的原子 span 节点

```html
产品图片：<span
  class="prompt-slot"
  data-slot-usage="主产品图"
  contenteditable="false"
>@［主产品图］</span>
```

- `contenteditable=false` → 原子节点，光标不会进去拆散，删除整块走
- 点击 span → 弹上传/选图面板 → 选完图，span 内部 DOM 换成缩略图，`data-slot-usage` 保留
- `editorRef.innerText` 读到 `产品图片：@[主产品图]` —— **与现有 `handleInput` 兼容**
- 用户选的图存前端 state：`slotImages: Record<usage, imageMeta>`

**删除**：span hover 显示删除叉 → 点删除 → span 恢复空插槽形态，`slotImages[usage]` 清掉。

**回填改造**：`TemplateCardItem.tsx:34` 的 `onAppendPrompt?.(card.title)` 改为 `card.promptTemplate`。回填后需把纯文本里的 `@[...]` 解析成原子 span 写入 contentEditable（现有 useEffect 只写 innerText，要扩展成写结构化 DOM）。

> ⚠️ 上述是**技术建议**，实现归 #IK4Z8G 前端定。

---

## 五、运营后台方案（归 #IK4Z8N）

spec 要复用 IK1565 的 Tab 配置后台。**但 IK1565 后台不存在**（IK1565 没落地）。

- **路 A（推荐）**：IK4QUV 自带最小后台（卡片 CRUD + 字段定义配置器 + 字段值填写），先解决能配。等 IK1565 落地后再合并入口。
- **路 B**：先做 IK1565（含后台），IK4QUV 挂进去。但 IK1565 已作废过一次，等它会拖死 IK4QUV。

后台需要的接口（#IK4Z8F）：卡片 CRUD（含 enabled/排序）、字段定义 CRUD（按 tag_code）、字段值读写（按 card_id）。

---

## 六、child 工单（6 个，已建，全 ready-for-agent 待认领）

| ident | 段 | 标题 | 归属 | 依赖 |
|---|---|---|---|---|
| #IK4Z8D | 卡片 | 结构化字段数据模型 | 后端 | — |
| #IK4Z8F | 卡片 | 卡片/字段/字段值 CRUD API | 后端 | #IK4Z8D |
| #IK4Z8G | 卡片 | 输入框占位符交互 | 前端 | — |
| #IK4Z8L | 卡片 | 点卡片结构化回填 | 前端 | #IK4Z8D, #IK4Z8G |
| #IK4Z8N | 卡片 | 运营后台 UI | 前端 | #IK4Z8F |
| #IK4Z8O | 衔接 | 首页 → canvas 跳转（传模板 + 图作为初始对话需求）| 前端 | #IK4Z8D, IK4Q48 |

**Frontier（无 blocking，可立即开工）**：#IK4Z8D、#IK4Z8G。

> 原设想的 B3'（forced skill 绑定）因对接 IK4Q48 取消，未建。

---

## 七、跟 IK4Q48 / IK2D7Z 的关系

```
IK4QUV（首页案例卡片 → 进 canvas，输入端）
  ├─ 卡片：#IK4Z8D / #IK4Z8F / #IK4Z8G / #IK4Z8L / #IK4Z8N
  └─ 衔接：#IK4Z8O（模板+图 → canvas 对话）
        │
        ▼ 衔接后交棒
IK4Q48（canvas 场景卡创作流，@kimjohn，已评审冻结）
  └─ 对齐 → 计划卡 → 场景卡 → 生成
        │
        ▼ 底座
IK2D7Z（声明式 Runtime Agent Bundle，@kimjohn，progressing）
```

- **IK4QUV**：首页案例卡片输入端。
- **IK4Q48**：canvas 内创作流权威。IK4QUV 进 canvas 后全程走它。
- **IK2D7Z**：IK4Q48 底下的 agent runtime 底座。间接依赖。
- ~~IJZ7Z7~~ wontfix（被 IK2D7Z 取代）；~~IJZ7Z9~~ rejected（Dock 直生）；~~forced skill~~ 取消——都不经。

---

## 八、风险点

1. **contentEditable + contenteditable=false span 边界**：删除键可能整块删或留残渣；浏览器差异。#IK4Z8G 须手动验证 + 占位符解析单测（纯函数：文本 ↔ 结构化 DOM）。
2. **回填后图位必须为空**：后端拼 promptTemplate 时，image_slot 字段只输出 `@[用途名]`，绝不带案例图 URL。案例图只在卡片展示（`template_card_image`）。
3. **字段定义变更与存量值一致性**：运营删字段/改 field_key 后，存量 field_value 怎么办。建议软删（enabled=0），存量值保留不报错（参考 IK1565「留孤卡」策略）。
4. **占位符用途名重名**：同一卡片内多个 image_slot 用途名不能重（否则 `slotImages` 键冲突）。后端校验或前端去重。
