package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public final class RuntimeBundleApi {

    private RuntimeBundleApi() {}

    public record CreateAgentRequest(
            @JsonProperty("agent_definition_id") String agentDefinitionId,
            String key,
            @JsonProperty("display_name") String displayName,
            String description) {}

    public record AgentDefinitionResponse(
            @JsonProperty("agent_definition_id") String agentDefinitionId,
            String key,
            @JsonProperty("display_name") String displayName,
            String description,
            @JsonProperty("active_bundle_version_id") String activeBundleVersionId) {}

    public record CreateDraftRequest(
            @JsonProperty("base_version_id") String baseVersionId,
            JsonNode composition,
            List<JsonNode> resources) {}

    public record DraftResponse(
            @JsonProperty("draft_id") String draftId,
            @JsonProperty("agent_definition_id") String agentDefinitionId,
            @JsonProperty("base_version_id") String baseVersionId,
            @JsonProperty("draft_revision") int draftRevision,
            @JsonProperty("validation_state") String validationState,
            @JsonProperty("last_validated_revision") Integer lastValidatedRevision,
            JsonNode composition,
            JsonNode resources) {}

    public record UpdateDraftRequest(
            @JsonProperty("expected_revision") int expectedRevision,
            JsonNode composition,
            List<JsonNode> resources) {}

    public record PublishRequest(String version) {}

    public record VersionPointerRequest(
            @JsonProperty("bundle_version_id") String bundleVersionId) {}
}
