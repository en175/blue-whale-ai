package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

@Component
final class RuntimeBundleContractMapper {

    private final ObjectMapper objectMapper;

    RuntimeBundleContractMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    ObjectNode resourceManifest(ArrayNode resources, String baseUri) {
        ObjectNode manifest = objectMapper.createObjectNode()
                .put("formatVersion", 1)
                .put("baseUri", baseUri)
                .put("digestAlgorithm", "sha256");
        ArrayNode contractResources = objectMapper.createArrayNode();
        resources.forEach(resource -> contractResources.add(contractResource(resource)));
        manifest.set("resources", contractResources);
        return manifest;
    }

    ObjectNode publishedComposition(JsonNode draftComposition) {
        ObjectNode result = objectMapper.createObjectNode()
                .put("roleDocumentId", draftComposition.path("role_document_id").asText())
                .put("rootRuntimeSkillId", draftComposition.path("root_runtime_skill_id").asText());
        ObjectNode ruleSet = objectMapper.createObjectNode();
        ruleSet.set("rules", draftComposition.path("rule_set").path("rules").deepCopy());
        result.set("ruleSet", ruleSet);
        result.set("modelProfiles", modelProfilesToContract(draftComposition.path("model_profiles")));
        result.set("toolGrants", toolGrantsToContract(draftComposition.path("tool_grants")));
        result.set("tokenBudget", tokenBudgetToContract(draftComposition.path("token_budget")));
        result.set("resourceManifest", draftComposition.path("resource_manifest").deepCopy());
        return result;
    }

    ObjectNode draftComposition(JsonNode publishedComposition) {
        ObjectNode result = objectMapper.createObjectNode()
                .put("role_document_id", publishedComposition.path("roleDocumentId").asText())
                .put("root_runtime_skill_id", publishedComposition.path("rootRuntimeSkillId").asText());
        ObjectNode ruleSet = objectMapper.createObjectNode();
        ruleSet.set("rules", publishedComposition.path("ruleSet").path("rules").deepCopy());
        result.set("rule_set", ruleSet);

        ArrayNode modelProfiles = objectMapper.createArrayNode();
        publishedComposition.path("modelProfiles").forEach(profile -> {
            ObjectNode mapped = objectMapper.createObjectNode()
                    .put("model_profile_id", profile.path("modelProfileId").asText())
                    .put("version", profile.path("version").asText())
                    .put("model_key", profile.path("modelKey").asText())
                    .put("max_input_tokens", profile.path("maxInputTokens").asInt())
                    .put("max_output_tokens", profile.path("maxOutputTokens").asInt());
            mapped.set("capabilities", profile.path("capabilities").deepCopy());
            modelProfiles.add(mapped);
        });
        result.set("model_profiles", modelProfiles);

        ArrayNode toolGrants = objectMapper.createArrayNode();
        publishedComposition.path("toolGrants").forEach(grant -> {
            ObjectNode mapped = objectMapper.createObjectNode()
                    .put("tool_name", grant.path("toolName").asText())
                    .put("registry_version", grant.path("registryVersion").asInt())
                    .put("effect", grant.path("effect").asText())
                    .put("proposal_only", grant.path("proposalOnly").asBoolean());
            mapped.set("argument_schema", grant.path("argumentSchema").deepCopy());
            mapped.set("constraints", grant.path("constraints").deepCopy());
            toolGrants.add(mapped);
        });
        result.set("tool_grants", toolGrants);

        JsonNode budget = publishedComposition.path("tokenBudget");
        result.set("token_budget", objectMapper.createObjectNode()
                .put("estimator", budget.path("estimator").asText())
                .put("initial_context_max_tokens", budget.path("initialContextMaxTokens").asInt())
                .put("single_resource_max_tokens", budget.path("singleResourceMaxTokens").asInt())
                .put("active_context_max_tokens", budget.path("activeContextMaxTokens").asInt()));
        return result;
    }

    private ObjectNode contractResource(JsonNode resource) {
        ObjectNode mapped = objectMapper.createObjectNode()
                .put("resourceId", resource.path("resource_id").asText())
                .put("revision", resource.path("revision").asInt())
                .put("kind", resource.path("kind").asText())
                .put("path", resource.path("path").asText())
                .put("mediaType", resource.path("media_type").asText())
                .put("loadMode", resource.path("load_mode").asText())
                .put("contentDigest", resource.path("content_digest").asText())
                .put("sizeBytes", resource.path("size_bytes").asLong())
                .put("tokenEstimate", resource.path("token_estimate").asInt());
        ArrayNode references = objectMapper.createArrayNode();
        resource.path("references").forEach(reference -> references.add(objectMapper.createObjectNode()
                .put("rawRef", reference.path("raw_ref").asText())
                .put("resolvedResourceId", reference.path("resolved_resource_id").asText())));
        mapped.set("references", references);
        switch (resource.path("kind").asText()) {
            case "rule" -> {
                if (resource.path("conflict_domain").isMissingNode()
                        || resource.path("conflict_domain").isNull()) {
                    mapped.putNull("conflictDomain");
                } else {
                    mapped.put("conflictDomain", resource.path("conflict_domain").asText());
                }
            }
            case "runtime_skill", "creative_skill" -> {
                JsonNode metadata = resource.path("metadata");
                mapped.set("metadata", objectMapper.createObjectNode()
                        .put("name", metadata.path("name").asText())
                        .put("description", metadata.path("description").asText())
                        .put("allowImplicitInvocation",
                                metadata.path("allow_implicit_invocation").asBoolean()));
                if ("creative_skill".equals(resource.path("kind").asText())) {
                    mapped.put("creativeSkillId", resource.path("creative_skill_id").asText());
                    mapped.put("version", resource.path("version").asText());
                }
            }
            default -> {
            }
        }
        return mapped;
    }

    private ArrayNode modelProfilesToContract(JsonNode profiles) {
        ArrayNode result = objectMapper.createArrayNode();
        profiles.forEach(profile -> {
            ObjectNode mapped = objectMapper.createObjectNode()
                    .put("modelProfileId", profile.path("model_profile_id").asText())
                    .put("version", profile.path("version").asText())
                    .put("modelKey", profile.path("model_key").asText())
                    .put("maxInputTokens", profile.path("max_input_tokens").asInt())
                    .put("maxOutputTokens", profile.path("max_output_tokens").asInt());
            mapped.set("capabilities", profile.path("capabilities").deepCopy());
            result.add(mapped);
        });
        return result;
    }

    private ArrayNode toolGrantsToContract(JsonNode grants) {
        ArrayNode result = objectMapper.createArrayNode();
        grants.forEach(grant -> {
            ObjectNode mapped = objectMapper.createObjectNode()
                    .put("toolName", grant.path("tool_name").asText())
                    .put("registryVersion", grant.path("registry_version").asInt())
                    .put("effect", grant.path("effect").asText())
                    .put("proposalOnly", grant.path("proposal_only").asBoolean());
            mapped.set("argumentSchema", grant.path("argument_schema").deepCopy());
            mapped.set("constraints", grant.path("constraints").deepCopy());
            result.add(mapped);
        });
        return result;
    }

    private ObjectNode tokenBudgetToContract(JsonNode budget) {
        return objectMapper.createObjectNode()
                .put("estimator", budget.path("estimator").asText())
                .put("initialContextMaxTokens", budget.path("initial_context_max_tokens").asInt())
                .put("singleResourceMaxTokens", budget.path("single_resource_max_tokens").asInt())
                .put("activeContextMaxTokens", budget.path("active_context_max_tokens").asInt());
    }
}
