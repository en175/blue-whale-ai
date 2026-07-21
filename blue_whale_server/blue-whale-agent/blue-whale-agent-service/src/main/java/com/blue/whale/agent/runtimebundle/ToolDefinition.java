package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Set;

/**
 * 平台以程序注册表定义的 Agent 可提议工具，是发布期 ToolGrant 校验的运行时权威。
 *
 * <p>不可变值类型。每项工具以 {@code toolId + registryVersion} 为主键，由 {@link ToolRegistry}
 * 程序注册。{@code inputSchema} / {@code outputSchema} 必须是自包含 Draft 2020-12 JSON Schema
 * （禁外部 / 动态 / 递归 {@code $ref}）；{@code constraints} 是平台对该工具的静态约束上界，
 * ToolGrant 的 {@code argument_schema} / {@code constraints} 经 {@code schemaNoWider} /
 * {@code constraintsNoWider} 判定不得宽于本注册项。
 *
 * <p>{@code riskLevel} 是注册表侧属性，ToolGrant 不携带；{@code requiredModelCapabilities} 对接
 * ModelProfile 的能力维度，{@code generationCapabilityType} 对接 {@code generation_model_capability}
 * 的 {@code capabilityType}（仅副作用生图 / 生视频工具有意义，只读工具为 {@code null}）。
 *
 * <p>当前发布期 ToolGrant 校验仅读 {@code effect} / {@code inputSchema} / {@code constraints}；
 * {@code riskLevel} / {@code requiredModelCapabilities} / {@code generationCapabilityType} 的消费者在
 * 后续子工单（Worker 工具可见性、生图能力对接），本注册表先落字段不落校验，避免误读为已接入。
 */
public record ToolDefinition(
        String toolId,
        int registryVersion,
        String effect,
        RiskLevel riskLevel,
        JsonNode inputSchema,
        JsonNode outputSchema,
        JsonNode constraints,
        Set<String> requiredModelCapabilities,
        String generationCapabilityType) {

    /**
     * 派生治理链（{@code GenerationAuthorizationGate} / {@code PriceCatalog} / 审计）使用的稳定动作标识。
     * image 生图能力映射为 {@code generate_image}，video 生视频能力映射为 {@code generate_video}
     * （对接 {@code PriceCatalog} 报价分支与 {@code GenerationJobCommandService} 共用的标识）；
     * 其余能力直接以 {@code generationCapabilityType} 作为动作标识。
     */
    public String actionType() {
        if ("image".equals(generationCapabilityType)) {
            return "generate_image";
        }
        if ("video".equals(generationCapabilityType)) {
            return "generate_video";
        }
        return generationCapabilityType;
    }
}
