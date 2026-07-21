package com.blue.whale.agent.runtimebundle;

import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public final class RuntimeBundleRunPinResolver {

    private final JdbcTemplate jdbcTemplate;
    private final RuntimeBundleService runtimeBundleService;
    private final boolean enforcementEnabled;
    private final String defaultAgentDefinitionId;

    RuntimeBundleRunPinResolver(
            JdbcTemplate jdbcTemplate,
            RuntimeBundleService runtimeBundleService,
            @Value("${blue-whale.runtime-bundle.enforcement-enabled:true}") boolean enforcementEnabled,
            @Value("${blue-whale.runtime-bundle.default-agent-definition-id:canvas_agent}")
                    String defaultAgentDefinitionId) {
        this.jdbcTemplate = jdbcTemplate;
        this.runtimeBundleService = runtimeBundleService;
        this.enforcementEnabled = enforcementEnabled;
        this.defaultAgentDefinitionId = defaultAgentDefinitionId;
    }

    public RunPin resolve(AgentRun sourceRun) {
        if (!enforcementEnabled) {
            return RunPin.disabled();
        }
        if (sourceRun != null) {
            return inherited(sourceRun);
        }
        List<PublishedPin> pins = jdbcTemplate.query("""
                SELECT definition.active_bundle_version_id, version.manifest_digest
                FROM runtime_agent_definitions definition
                JOIN runtime_bundle_versions version
                  ON version.bundle_version_id = definition.active_bundle_version_id
                WHERE definition.agent_definition_id = ?
                """, (resultSet, rowNumber) -> new PublishedPin(
                        resultSet.getString("active_bundle_version_id"),
                        resultSet.getString("manifest_digest")), defaultAgentDefinitionId);
        if (pins.size() != 1) {
            throw unavailable("默认 Agent 没有唯一的激活 BundleVersion");
        }
        PublishedPin pin = pins.get(0);
        JsonNode snapshot = runtimeBundleService.readVersion(pin.bundleVersionId());
        JsonNode composition = snapshot.path("composition");
        JsonNode modelProfiles = composition.path("modelProfiles");
        if (!modelProfiles.isArray() || modelProfiles.isEmpty()) {
            throw unavailable("激活 BundleVersion 未声明可用 ModelProfile");
        }
        JsonNode model = modelProfiles.get(0);
        String manifestInSnapshot = composition.path("resourceManifest")
                .path("manifestDigest").asText(pin.manifestDigest());
        if (!pin.manifestDigest().equals(manifestInSnapshot)) {
            throw unavailable("激活 BundleVersion 的 manifest 摘要不一致");
        }
        // Creative Skill 首次激活固定由后续运行时任务承接；契约不允许 Bundle 声明
        // activatedCreativeSkillVersions（发布期白名单拒绝），新 Run 该字段恒为空数组。
        // ToolGrant 从激活 BundleVersion 快照 composition.toolGrants 解析，透传给 Worker
        // 作为当次模型可见工具集的权威；快照未声明 grants（纯文本对话）视作空集。
        JsonNode toolGrantsNode = composition.path("toolGrants");
        String toolGrantsJson = toolGrantsNode.isArray() ? toolGrantsNode.toString() : "[]";
        return requiredPin(
                pin.bundleVersionId(), pin.manifestDigest(),
                model.path("modelProfileId").asText(), model.path("version").asText(),
                "[]",
                toolGrantsJson);
    }

    private RunPin inherited(AgentRun sourceRun) {
        return requiredPin(
                sourceRun.getBundleVersionId(), sourceRun.getManifestDigest(),
                sourceRun.getModelProfileId(), sourceRun.getModelProfileVersion(),
                sourceRun.getActivatedCreativeSkillVersions(),
                sourceRun.getToolGrants());
    }

    private RunPin requiredPin(
            String bundleVersionId,
            String manifestDigest,
            String modelProfileId,
            String modelProfileVersion,
            String creativeSkillVersions,
            String toolGrants) {
        if (blank(bundleVersionId) || blank(manifestDigest)
                || blank(modelProfileId) || blank(modelProfileVersion)) {
            throw unavailable("Runtime Bundle 运行身份不完整");
        }
        return new RunPin(bundleVersionId, manifestDigest, modelProfileId, modelProfileVersion,
                blank(creativeSkillVersions) ? "[]" : creativeSkillVersions,
                blank(toolGrants) ? "[]" : toolGrants);
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private GlobalException unavailable(String message) {
        return new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, message);
    }

    public record RunPin(
            String bundleVersionId,
            String manifestDigest,
            String modelProfileId,
            String modelProfileVersion,
            String activatedCreativeSkillVersions,
            String toolGrants) {

        static RunPin disabled() {
            return new RunPin(null, null, null, null, null, null);
        }
    }

    private record PublishedPin(String bundleVersionId, String manifestDigest) {}
}
