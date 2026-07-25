-- V11：AgentRun 钉住 BundleVersion 的 ToolGrant 列（IK2QBS）
-- Worker Adapter 按当次 Run 钉住的 BundleVersion 的 ToolGrant 动态构造模型工具集，
-- 未授权工具不出现在模型可见工具列表。ToolGrant 列存该 Run 创建时从激活 BundleVersion
-- 快照 composition.toolGrants 解析出的契约子集（JSON 文本），claim 工作包时透传给 Worker。

ALTER TABLE agent_runs
    ADD COLUMN tool_grants JSON NULL AFTER activated_creative_skill_versions;
