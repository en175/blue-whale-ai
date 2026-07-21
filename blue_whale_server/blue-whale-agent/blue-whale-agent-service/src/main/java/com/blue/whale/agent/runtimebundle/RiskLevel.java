package com.blue.whale.agent.runtimebundle;

/**
 * 工具风险等级，是工具注册表（{@link ToolRegistry}）侧的属性。
 *
 * <p>{@code ToolGrant} 只引用 {@code tool_id + registry_version} 并收窄约束，不携带风险等级；
 * 风险等级由平台在注册工具时确定，用于运行期接纳策略与审计，不参与发布期 grant 校验。
 */
enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH
}
