package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * 按 AgentRun 钉住的 BundleVersion 解析该 Run 实际授权的 ToolGrant。
 *
 * <p>commit 接纳路径用它取 Run 钉住的 grant（发布快照 composition.toolGrants），再与注册表
 * {@link ToolDefinition} 经 {@link ToolGrantScope} 做 schemaNoWider / constraintsNoWider 复验。
 * 未授权（grant 不在 Run 的快照中）或 bundleVersionId 缺失（enforcement=false 降级）时返回 empty。
 */
@Component
public final class RunToolGrantResolver {

    private final RuntimeBundleService runtimeBundleService;

    RunToolGrantResolver(RuntimeBundleService runtimeBundleService) {
        this.runtimeBundleService = runtimeBundleService;
    }

    public Optional<ResolvedToolGrant> resolve(String bundleVersionId, String toolId, int registryVersion) {
        if (bundleVersionId == null || bundleVersionId.isBlank() || toolId == null) {
            return Optional.empty();
        }
        JsonNode grants = runtimeBundleService.readVersion(bundleVersionId)
                .path("composition").path("toolGrants");
        for (JsonNode grant : grants) {
            if (toolId.equals(grant.path("toolName").asText())
                    && registryVersion == grant.path("registryVersion").asInt()) {
                return Optional.of(new ResolvedToolGrant(
                        grant.path("argumentSchema"),
                        grant.path("constraints"),
                        grant.path("effect").asText(),
                        grant.path("proposalOnly").asBoolean(false)));
            }
        }
        return Optional.empty();
    }

    public record ResolvedToolGrant(
            JsonNode argumentSchema, JsonNode constraints, String effect, boolean proposalOnly) {
    }
}
