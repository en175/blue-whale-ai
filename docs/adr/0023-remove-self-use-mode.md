# ADR 0023: 删除 blue_whale_api 自用模式全链路,未配价模型硬报错

- 状态:Proposed(2026-07-23)
- 决策者:李述 + Claude(grill-with-docs 会话 IK3HGV)
- 上游工单:IK3HGV(epic)/ IK3HHD

## 背景

new-api **自用模式**(`SelfUseModeEnabled`,默认 false)+ **用户级 `AcceptUnsetRatioModel`**:模型未配价时不报错,用 fallback 倍率 37.5 兜底(`GetModelRatio` `setting/ratio_setting/model_ratio.go:407` `return 37.5, SelfUseModeEnabled`)。`ListModels`(`controller/model.go:209`)据此决定是否在模型列表显示未配价模型;`relay/helper/price.go:103,203` 据此在计费时容忍未配价。

企业级严格计费场景,"未配价兜底 37.5"是反模式:静默用错价、计费不可预测。即使配合 ADR 0022 删默认 map,只要自用模式开着,未配价模型仍走 37.5 不报错——**删 map 达不到"硬报错"目标**。

## 决策

**删除自用模式全链路(全局 + 用户级 + UI)**,未配价模型一律硬报错:

1. `GetModelRatio` fallback(`model_ratio.go:407`)`return 37.5, SelfUseModeEnabled` → `return 0, false`(硬报错,不再有 37.5 兜底)。
2. 删全局 `SelfUseModeEnabled`:`operation_setting.go:6` 变量、`model/option.go` option 加载、`controller/setup.go` setup 向导字段、`controller/misc.go:91` status 暴露、`controller/model.go:209` ListModels 过滤分支、管理员设置页开关 UI(`system-behavior-section.tsx`)。
3. 删用户级 `AcceptUnsetRatioModel`:`dto/user_settings.go` 字段、`controller/user.go`、`controller/model.go:214`、`relay/helper/price.go:103,203` 计费容忍两处。
4. 前端连带:`setup/*` 向导、`auth/sign-in` 登录页条件、`system-settings/types`、`operations/*` 聚合。

## 考虑过的替代方案

- **只关不自删**(`SelfUseModeEnabled=false` 默认已是):零代码改动,行为已"未配价报错"。但开关 UI 还在,管理员可能误开 → 又走 37.5。死开关别扭,且达不到"根除"。**否决**。
- **核心 + 全局入口(不含用户级)**:留用户级 `AcceptUnsetRatioModel` 给特定账号测试。**否决**:用户选"全删",企业严格计费不留 per-user 容错后门。

## 后果

- 计费绝对可预测:任何模型未配价即报错,无兜底、无例外。
- 新模型上线必须先配价才能调(含测试),流程更严。
- 改动面 ~21 处(后端 Go 9 文件 + 前端 TS 多处),跨 `price.go` 计费路径/setup/登录页,风险高于 ADR 0022(改逻辑非数据)。
- fork 分叉进一步加大(自用模式是 new-api 核心特性)。

## 相关

- 工单:IK3HGV(epic)/ IK3HHD(本决策)
- 配套:ADR 0022(删默认 ratio map)
- 计费公式不变:见 CONTEXT.md「计费与货币」(quota = (输入token + 输出token×CompletionRatio) × ModelRatio × GroupRatio)
