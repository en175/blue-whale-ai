# Creative Skill 结构化迁移 + 推荐/冲突判定 — 需求 Spec（MVP）

| 项 | 值 |
|---|---|
| 状态 | Draft（待后端反馈开放问题 §8） |
| 日期 | 2026-07-28 |
| 范围 | 数据层（配方结构化）+ 后端接口（推荐/冲突判定）。前端改造另开工单。 |
| 关联 | IK2D8R（runtime-bundle 迁移；本 spec 是其挂账的 Creative Skill 库 + Use/auto 链路后续工单） |
| 契约依据 | `2026-07-20-runtime-agent-bundle-contract.md` §9；`2026-07-24-creative-skill-activation-contract.md` |

## 0. 目的

Creative Skill 库从「散文创作模板」变「机器可判结构化意图」，支撑推荐 / 冲突判定 / 默认参数填充，减少用户手选错配方、降低生成方向错误损耗。

**现状**：108 配方是散文 raw（`library/raw/cn01–cn108`），`skill_selector` 靠 LLM 读全文匹配，无结构化字段支撑推荐/冲突。

## 1. 产品行为（后端要支撑的 4 分支）

生成 = skill + brief 同时具备（skill=创作方法，brief=要创作什么）。

| 用户输入 | 系统响应 |
|---|---|
| 有 skill + brief，无硬冲突 | 直接生成 |
| 有 skill + brief，硬冲突（风格/类型矛盾） | 返回冲突数据，供三选一询问 |
| 无 skill + brief | 返回 ≤3 推荐，自然语言选 → 生成 |
| 无 brief | progressive_disclosure 追问（不生成） |

skill 选中方式：模板卡片点选 / 推荐项自然语言指代（"用第一个"/"试 TVC"）。**自然语言为主，按钮为可选快捷**（前端改造另开）。

## 2. 配方结构化需求（a2-ii）

每个 CreativeSkill 在契约既有字段（`name/description/version/cover/sortOrder`）外，需结构化表达：

| 维度 | 用途 | 示例（cn01 TVC） |
|---|---|---|
| `creative_direction` | 风格调性（冲突判定读） | 视觉：慢速推轨/微距/环绕；灯光：柔和补光/轮廓光 |
| `applicability.fit / not_fit` | 推荐匹配（skill_selector 读） | fit：高端品牌片；not_fit：UGC/快销 |
| `script_structure` | 整片分段+时间码（生成拆解读） | 开场0-3s/中段3-18s/结尾18-25s |
| `default_params` | 默认时长/比例/分辨率（软参数填充） | 9:16/720p/单段5s |
| `constraints.must_avoid` | 禁止项（约束生成） | 禁平台行动号召、拥挤场景 |
| `shot_techniques` | 引用技法片段 id | `[cn03-4A, cn03-6A]` |

**边界**：具体存储建模（JSON/独立表/fragment 关联）归后端。本 spec 只定"配方需能表达这些维度"。

## 3. 冲突判定产品规则

- **硬冲突维度** = 风格调性 + 视频类型大类（TVC/UGC/微短剧/口播 不同配方族）→ 触发询问
- **软参数** = 时长/比例/平台/分辨率 → 不判冲突，brief 提到就覆盖 skill 默认
- **硬冲突后端返回**：冲突维度 + 原 skill + 建议替换 skill（供前端三选一：①换推荐 / ②保留原忽略冲突 / ③两个都试各出一版）
- 匹配算法归后端；PM 只定**哪些维度冲突算"该问"**

## 4. 推荐接口需求

- **触发**：无 skill + 有 brief
- **输入**：brief
- **输出**：≤3 推荐，按匹配度排序。每项含 `creative_skill_id / name / description / reason`
- **reason** = 简洁一句话，点明匹配维度（调性/类型/场景）。例：brief "10s 抖音快节奏护肤" → cn27 快节奏USP，reason "快节奏调性 + 短视频适配"
- **匹配依据**：配方 `applicability` + brief 语义（算法归后端）
- **可被自然语言指代**：用户说"用第一个"/"试 TVC"能定位推荐项（支持序号 + name 指代）

## 5. 迁移范围（MVP）

**配方**（11 个，覆盖大类）：
`cn01` TVC / `cn02` UGC / `cn05` 痛点 / `cn08` 微短剧 / `cn13` 前后对比 / `cn14` 产品展示 / `cn17` 口播 / `cn18` 故事驱动 / `cn22` 对比测试 / `cn23` 开箱演示 / `cn27` 快节奏USP

**技法片段**（cn03 抽 6 个高频做 fragment）：
`cn03-4A` 单点透视轨道（慢推）/ `cn03-4B` 横向推轨 / `cn03-6A` 子弹时间环绕 / `cn03-3A` 斯坦尼康跟拍 / `cn03-2A` 塔可夫斯基漂浮 / `cn03-1A` 眩晕变焦

剩余 ~97 配方 + cn04/cn35 toolkit → 后续工单。

## 6. 验收标准

- **数据层**：11 配方 + 6 技法片段完成结构化，§2 维度全覆盖
- **推荐**：给定 brief 返 ≤3 推荐 + 可解释 reason
- **冲突**：`TVC skill + "快节奏抖音风"` 返硬冲突 + 三选一数据；`TVC + "10s"` 不触发冲突（软参数吸收）
- **端到端**：cn01 + cn03-4A 跑通「配方 intent → storyboard 拆段 → 中性 GenerationJob → provider prompt」（mock provider 即可）

## 7. 不在本 spec（边界）

- 前端交互改造（按钮→自然语言、冲突三选一 UI、推荐区加 reason 行）→ 另开工单
- provider adapter 实现（豆包/即梦/Seedance 真接入）→ providers 层
- 配方库运营后台（增删改 UI）→ 另开工单
- 剩余配方 + toolkit 全量迁移 → 后续工单

## 8. 开放问题（给后端反馈）

1. **技法 fragment 领域对象**：算 CreativeSkill 子类型，还是独立领域对象？（建模归后端；若影响契约 §2 需反馈）
2. **applicability 形式**：PM 推**结构化标签 + 人可读**（如 `fit: [高端品牌片, 电影级]`），理由：①机器匹配要结构化；②reason 要展示给用户（§4），标签可读才能生成简洁 reason。标签体系设计归后端。**待后端认。**
3. **~~匹配理由展示~~** → **已定**：简洁一句话展示给用户（§4 reason 字段）

## 9. 决策链（grilling 产出）

`video-shotcraft 借鉴 → a2 翻译层集中（不绑 provider）→ a2-ii 配方带结构化意图对象 → 双模式动线（skill+brief 必填一起）→ 硬冲突三选一/软参数吸收 → 推荐3个自然语言选 → 匹配理由简洁展示 → MVP 先迁11配方+6技法片段 → 工单只做数据层+后端接口，前端另开 → hand off 不建 wayfinder map（路径已清晰）`

> 技术方向 a2/a2-ii 依据：架构铁律「Provider 抽象不绑厂商」+ video-shotcraft「意图层/实现层分离」精神（实现层非 TSX，是 prompt-adapter）。
