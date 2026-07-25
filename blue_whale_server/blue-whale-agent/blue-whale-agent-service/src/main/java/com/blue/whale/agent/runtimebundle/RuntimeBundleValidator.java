package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class RuntimeBundleValidator {

    private static final Pattern IDENTIFIER = Pattern.compile("^[a-z][a-z0-9_]{2,79}$");
    private static final Pattern SEMVER = Pattern.compile(
            "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)"
                    + "(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?"
                    + "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$");
    private static final Pattern RESOURCE_PATH = Pattern.compile(
            "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)"
                    + "[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$");
    private static final Pattern MEDIA_TYPE = Pattern.compile(
            "^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+(?:;.*)?$");
    private static final Pattern URI_SCHEME = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*:.*$");
    private static final Set<String> RESOURCE_KINDS =
            Set.of("role_document", "rule", "runtime_skill", "creative_skill", "reference");
    private static final Set<String> CAPABILITIES =
            Set.of("text", "vision", "tool_calling", "structured_output");
    private static final Set<String> SENSITIVE_FIELDS = Set.of(
            "api_key", "apikey", "credential", "credentials", "password", "secret",
            "access_token", "private_key");
    private static final Set<String> COMPOSITION_FIELDS = Set.of(
            "role_document_id", "rule_set", "root_runtime_skill_id", "model_profiles",
            "tool_grants", "token_budget", "resource_manifest");
    private static final Set<String> COMMON_RESOURCE_FIELDS = Set.of(
            "resource_id", "revision", "kind", "path", "media_type", "load_mode",
            "content_digest", "size_bytes", "token_estimate", "references", "content");
    private static final Set<String> SKILL_METADATA_FIELDS =
            Set.of("name", "description", "allow_implicit_invocation");
    private static final Set<String> MODEL_PROFILE_FIELDS = Set.of(
            "model_profile_id", "version", "model_key", "capabilities",
            "max_input_tokens", "max_output_tokens");
    private static final Set<String> TOOL_GRANT_FIELDS = Set.of(
            "tool_name", "registry_version", "effect", "proposal_only",
            "argument_schema", "constraints");
    private static final Set<String> TOKEN_BUDGET_FIELDS = Set.of(
            "estimator", "initial_context_max_tokens", "single_resource_max_tokens",
            "active_context_max_tokens");

    private final ObjectMapper objectMapper;
    private final RuntimeBundleDigests digests;
    private final RuntimeBundleContractMapper contractMapper;
    private final RuntimeBundleSchemaValidator schemaValidator;
    private final ToolRegistry toolRegistry;
    private final ToolGrantScope toolGrantScope;
    private final Set<ApprovedModelContract> approvedModelContracts;
    private final Set<String> approvedTokenEstimators;

    RuntimeBundleValidator(
            ObjectMapper objectMapper,
            RuntimeBundleDigests digests,
            RuntimeBundleContractMapper contractMapper,
            RuntimeBundleSchemaValidator schemaValidator,
            ToolRegistry toolRegistry,
            ToolGrantScope toolGrantScope,
            @Value("${blue-whale.runtime-bundle.approved-model-contracts:}") String configuredModels,
            @Value("${blue-whale.runtime-bundle.approved-token-estimators:}")
                    String configuredTokenEstimators) {
        this.objectMapper = objectMapper;
        this.digests = digests;
        this.contractMapper = contractMapper;
        this.schemaValidator = schemaValidator;
        this.toolRegistry = toolRegistry;
        this.toolGrantScope = toolGrantScope;
        this.approvedModelContracts = configuredModelContracts(configuredModels);
        this.approvedTokenEstimators = configuredValues(configuredTokenEstimators);
    }

    ValidationResult validate(JsonNode rawComposition, JsonNode rawResources) {
        return validate(rawComposition, rawResources, "bw-bundle://pending/");
    }

    ValidationResult validate(JsonNode rawComposition, JsonNode rawResources, String baseUri) {
        List<String> errors = new ArrayList<>();
        ObjectNode composition = rawComposition != null && rawComposition.isObject()
                ? (ObjectNode) rawComposition.deepCopy()
                : objectMapper.createObjectNode();
        if (rawComposition == null || !rawComposition.isObject()) {
            errors.add("invalid_composition");
        }
        validateCompositionFields(composition, errors);
        if (containsSensitiveField(composition) || containsSensitiveField(rawResources)) {
            errors.add("sensitive_configuration");
        }

        ArrayNode resources = normalizeResources(rawResources, errors);
        Map<String, JsonNode> byId = indexResources(resources, errors);
        validateRoleAndRoot(composition, byId, resources, errors);
        validateReferences(byId, errors);
        validateRuleSet(composition, byId, errors);
        validateModelsAndTools(composition, errors);
        validateTokenBudget(composition, resources, errors);

        ArrayNode sortedResources = objectMapper.createArrayNode();
        byId.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .forEach(entry -> sortedResources.add(entry.getValue()));
        ObjectNode manifest = contractMapper.resourceManifest(sortedResources, baseUri);
        String manifestDigest = digests.canonicalJson(manifest);
        manifest.put("manifestDigest", manifestDigest);
        composition.set("resource_manifest", manifest);
        return new ValidationResult(List.copyOf(errors), composition, resources, manifestDigest);
    }

    boolean validSemanticVersion(String value) {
        return value != null && SEMVER.matcher(value).matches();
    }

    private ArrayNode normalizeResources(JsonNode rawResources, List<String> errors) {
        ArrayNode normalized = objectMapper.createArrayNode();
        if (rawResources == null || !rawResources.isArray()) {
            errors.add("invalid_resources");
            return normalized;
        }
        for (JsonNode raw : rawResources) {
            if (!raw.isObject()) {
                errors.add("invalid_resource");
                continue;
            }
            ObjectNode resource = (ObjectNode) raw.deepCopy();
            String resourceId = resource.path("resource_id").asText();
            validateResourceFields(resource, errors);
            if (!resource.has("content") || !resource.path("content").isTextual()) {
                errors.add("invalid_resource_content:" + resourceId);
            }
            String content = resource.path("content").asText("");
            if (content.startsWith("\ufeff") || content.indexOf('\r') >= 0) {
                errors.add("invalid_resource_encoding:" + resourceId);
            }
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            String computedDigest = digests.content(content);
            String suppliedDigest = resource.path("content_digest").asText();
            if (!suppliedDigest.isBlank() && !computedDigest.equals(suppliedDigest)) {
                errors.add("content_digest_mismatch:" + resourceId);
            }
            resource.put("content_digest", computedDigest);
            resource.put("size_bytes", bytes.length);
            resource.put("token_estimate", content.isEmpty() ? 0 : Math.max(1, (content.length() + 3) / 4));
            if (!resource.has("references") || !resource.path("references").isArray()) {
                errors.add("invalid_references:" + resourceId);
                resource.set("references", objectMapper.createArrayNode());
            }
            validateResourceShape(resource, errors);
            normalized.add(resource);
        }
        return normalized;
    }

    private void validateResourceShape(ObjectNode resource, List<String> errors) {
        String resourceId = resource.path("resource_id").asText();
        if (!IDENTIFIER.matcher(resourceId).matches()) {
            errors.add("invalid_resource_id:" + resourceId);
        }
        if (!resource.path("revision").canConvertToInt() || resource.path("revision").asInt() < 1) {
            errors.add("invalid_resource_revision:" + resourceId);
        }
        String kind = resource.path("kind").asText();
        if (!RESOURCE_KINDS.contains(kind)) {
            errors.add("invalid_resource_kind:" + resourceId);
        }
        String path = resource.path("path").asText();
        if (path.length() > 512 || !RESOURCE_PATH.matcher(path).matches()) {
            errors.add("invalid_resource_path:" + resourceId);
        }
        String mediaType = resource.path("media_type").asText();
        if (!MEDIA_TYPE.matcher(mediaType).matches()) {
            errors.add("invalid_media_type:" + resourceId);
        }
        String loadMode = resource.path("load_mode").asText();
        boolean allowedMode = switch (kind) {
            case "role_document" -> "always_on".equals(loadMode);
            case "runtime_skill", "creative_skill", "reference" -> "on_demand".equals(loadMode);
            case "rule" -> "always_on".equals(loadMode) || "on_demand".equals(loadMode);
            default -> false;
        };
        if (!allowedMode) {
            errors.add("invalid_load_mode:" + resourceId);
        }
        if (Set.of("role_document", "rule", "runtime_skill", "creative_skill").contains(kind)
                && !"text/markdown".equals(mediaType)) {
            errors.add("invalid_media_type:" + resourceId);
        }
        if (Set.of("runtime_skill", "creative_skill").contains(kind)) {
            JsonNode metadata = resource.path("metadata");
            if (!metadata.isObject()
                    || metadata.path("name").asText().isBlank()
                    || metadata.path("description").asText().isBlank()
                    || !metadata.has("allow_implicit_invocation")
                    || !metadata.path("allow_implicit_invocation").isBoolean()) {
                errors.add("invalid_skill_metadata:" + resourceId);
            }
        }
    }

    private void validateCompositionFields(ObjectNode composition, List<String> errors) {
        composition.fieldNames().forEachRemaining(field -> {
            if (!COMPOSITION_FIELDS.contains(field)) {
                errors.add("unknown_composition_field:" + field);
            }
        });
        JsonNode ruleSet = composition.path("rule_set");
        if (ruleSet.isObject()) {
            ruleSet.fieldNames().forEachRemaining(field -> {
                if (!"rules".equals(field)) {
                    errors.add("unknown_rule_set_field:" + field);
                }
            });
        }
        composition.path("model_profiles").forEach(profile -> {
            if (profile.isObject()) {
                String profileId = profile.path("model_profile_id").asText();
                profile.fieldNames().forEachRemaining(field -> {
                    if (!MODEL_PROFILE_FIELDS.contains(field)) {
                        errors.add("unknown_model_profile_field:" + profileId + ":" + field);
                    }
                });
            }
        });
        composition.path("tool_grants").forEach(grant -> {
            if (grant.isObject()) {
                String toolName = grant.path("tool_name").asText();
                grant.fieldNames().forEachRemaining(field -> {
                    if (!TOOL_GRANT_FIELDS.contains(field)) {
                        errors.add("unknown_tool_grant_field:" + toolName + ":" + field);
                    }
                });
            }
        });
        JsonNode tokenBudget = composition.path("token_budget");
        if (tokenBudget.isObject()) {
            tokenBudget.fieldNames().forEachRemaining(field -> {
                if (!TOKEN_BUDGET_FIELDS.contains(field)) {
                    errors.add("unknown_token_budget_field:" + field);
                }
            });
        }
    }

    private void validateResourceFields(ObjectNode resource, List<String> errors) {
        String resourceId = resource.path("resource_id").asText();
        Set<String> allowed = new HashSet<>(COMMON_RESOURCE_FIELDS);
        switch (resource.path("kind").asText()) {
            case "rule" -> allowed.add("conflict_domain");
            case "runtime_skill" -> allowed.add("metadata");
            case "creative_skill" -> allowed.addAll(Set.of("metadata", "creative_skill_id", "version"));
            default -> {
            }
        }
        resource.fieldNames().forEachRemaining(field -> {
            if (!allowed.contains(field)) {
                errors.add("unknown_resource_field:" + resourceId + ":" + field);
            }
        });
        resource.path("references").forEach(reference -> {
            if (reference.isObject()) {
                reference.fieldNames().forEachRemaining(field -> {
                    if (!Set.of("raw_ref", "resolved_resource_id").contains(field)) {
                        errors.add("unknown_reference_field:" + resourceId + ":" + field);
                    }
                });
            }
        });
        JsonNode metadata = resource.path("metadata");
        if (metadata.isObject()) {
            metadata.fieldNames().forEachRemaining(field -> {
                if (!SKILL_METADATA_FIELDS.contains(field)) {
                    errors.add("unknown_skill_metadata_field:" + resourceId + ":" + field);
                }
            });
        }
    }

    private Map<String, JsonNode> indexResources(ArrayNode resources, List<String> errors) {
        Map<String, JsonNode> byId = new HashMap<>();
        Set<String> paths = new HashSet<>();
        resources.forEach(resource -> {
            String resourceId = resource.path("resource_id").asText();
            if (byId.put(resourceId, resource) != null) {
                errors.add("duplicate_resource_id:" + resourceId);
            }
            String path = resource.path("path").asText();
            if (!path.isBlank() && !paths.add(path)) {
                errors.add("duplicate_resource_path:" + path);
            }
        });
        return byId;
    }

    private void validateRoleAndRoot(
            ObjectNode composition, Map<String, JsonNode> byId, ArrayNode resources, List<String> errors) {
        String roleId = composition.path("role_document_id").asText();
        long roleCount = countKind(resources, "role_document");
        if (roleCount != 1 || !"role_document".equals(kind(byId.get(roleId)))) {
            errors.add("invalid_role_document");
        }
        String rootSkillId = composition.path("root_runtime_skill_id").asText();
        long rootSkillCount = countKind(resources, "runtime_skill");
        if (rootSkillCount != 1 || !"runtime_skill".equals(kind(byId.get(rootSkillId)))) {
            errors.add("invalid_root_runtime_skill");
        }
    }

    private void validateReferences(Map<String, JsonNode> byId, List<String> errors) {
        Map<String, Set<String>> graph = new HashMap<>();
        byId.forEach((resourceId, resource) -> {
            Set<String> targets = new LinkedHashSet<>();
            resource.path("references").forEach(reference -> {
                String rawRef = reference.path("raw_ref").asText();
                String target = reference.path("resolved_resource_id").asText();
                if (!validRelativeReference(rawRef)) {
                    errors.add("invalid_reference_path:" + resourceId + ":" + rawRef);
                }
                JsonNode targetResource = byId.get(target);
                if (target.isBlank() || targetResource == null) {
                    errors.add("missing_reference:" + resourceId + ":" + target);
                } else {
                    targets.add(target);
                    String resolvedPath = resolveReference(resource.path("path").asText(), rawRef);
                    if (resolvedPath == null || !resolvedPath.equals(targetResource.path("path").asText())) {
                        errors.add("unresolved_reference:" + resourceId + ":" + rawRef);
                    }
                }
            });
            graph.put(resourceId, targets);
        });
        List<String> cycle = findCycle(graph);
        if (!cycle.isEmpty()) {
            errors.add("cyclic_dependency:" + String.join("->", cycle));
        }
    }

    private boolean validRelativeReference(String rawRef) {
        return !rawRef.isBlank()
                && !rawRef.startsWith("/")
                && !rawRef.contains("\\")
                && !URI_SCHEME.matcher(rawRef).matches()
                && !rawRef.contains("?")
                && !rawRef.contains("#");
    }

    private String resolveReference(String sourcePath, String rawRef) {
        if (!validRelativeReference(rawRef)) {
            return null;
        }
        Path source = Path.of(sourcePath);
        Path parent = source.getParent();
        Path resolved = (parent == null ? Path.of(rawRef) : parent.resolve(rawRef)).normalize();
        String value = resolved.toString().replace('\\', '/');
        return value.equals("..") || value.startsWith("../") || value.startsWith("/") ? null : value;
    }

    private List<String> findCycle(Map<String, Set<String>> graph) {
        Set<String> visited = new HashSet<>();
        List<String> stack = new ArrayList<>();
        for (String resourceId : graph.keySet()) {
            List<String> cycle = findCycle(resourceId, graph, visited, stack);
            if (!cycle.isEmpty()) {
                return cycle;
            }
        }
        return List.of();
    }

    private List<String> findCycle(
            String resourceId, Map<String, Set<String>> graph, Set<String> visited, List<String> stack) {
        int cycleStart = stack.indexOf(resourceId);
        if (cycleStart >= 0) {
            List<String> cycle = new ArrayList<>(stack.subList(cycleStart, stack.size()));
            cycle.add(resourceId);
            return cycle;
        }
        if (!visited.add(resourceId)) {
            return List.of();
        }
        stack.add(resourceId);
        for (String target : graph.getOrDefault(resourceId, Set.of())) {
            List<String> cycle = findCycle(target, graph, visited, stack);
            if (!cycle.isEmpty()) {
                return cycle;
            }
        }
        stack.remove(stack.size() - 1);
        return List.of();
    }

    private void validateRuleSet(ObjectNode composition, Map<String, JsonNode> byId, List<String> errors) {
        Set<String> conflictDomains = new HashSet<>();
        Set<String> ruleIds = new HashSet<>();
        JsonNode rules = composition.path("rule_set").path("rules");
        if (!rules.isArray()) {
            errors.add("invalid_rule_set");
            return;
        }
        rules.forEach(ruleIdNode -> {
            String ruleId = ruleIdNode.asText();
            if (!ruleIds.add(ruleId)) {
                errors.add("duplicate_rule:" + ruleId);
            }
            JsonNode rule = byId.get(ruleId);
            if (!"rule".equals(kind(rule))) {
                errors.add("missing_rule:" + ruleId);
                return;
            }
            String domain = rule.path("conflict_domain").asText();
            if (!domain.isBlank() && !conflictDomains.add(domain)) {
                errors.add("conflicting_rule:" + domain);
            }
        });
        byId.forEach((resourceId, resource) -> {
            if ("rule".equals(kind(resource)) && !ruleIds.contains(resourceId)) {
                errors.add("unlisted_rule:" + resourceId);
            }
        });
    }

    private void validateModelsAndTools(ObjectNode composition, List<String> errors) {
        JsonNode modelProfiles = composition.path("model_profiles");
        if (!modelProfiles.isArray() || modelProfiles.isEmpty()) {
            errors.add("missing_model_profile");
        } else {
            modelProfiles.forEach(profile -> {
                String modelKey = profile.path("model_key").asText();
                if (!matchesApprovedModel(profile)) {
                    errors.add("unauthorized_model:" + modelKey);
                }
                Set<String> capabilities = new HashSet<>();
                boolean validCapabilities = profile.path("capabilities").isArray()
                        && !profile.path("capabilities").isEmpty();
                if (validCapabilities) {
                    for (JsonNode capability : profile.path("capabilities")) {
                        validCapabilities &= CAPABILITIES.contains(capability.asText())
                                && capabilities.add(capability.asText());
                    }
                }
                if (!IDENTIFIER.matcher(profile.path("model_profile_id").asText()).matches()
                        || !validSemanticVersion(profile.path("version").asText())
                        || !validCapabilities
                        || profile.path("max_input_tokens").asInt(0) < 1
                        || profile.path("max_output_tokens").asInt(0) < 1) {
                    errors.add("invalid_model_profile:" + profile.path("model_profile_id").asText());
                }
            });
        }
        JsonNode toolGrants = composition.path("tool_grants");
        if (!toolGrants.isArray()) {
            errors.add("invalid_tool_grants");
            return;
        }
        toolGrants.forEach(grant -> {
            String toolName = grant.path("tool_name").asText();
            if (!matchesApprovedTool(grant) || !grant.path("proposal_only").asBoolean(false)) {
                errors.add("unauthorized_tool:" + toolName);
            }
            JsonNode argumentSchema = grant.path("argument_schema");
            if (grant.path("registry_version").asInt(0) < 1
                    || !Set.of("read", "side_effect").contains(grant.path("effect").asText())
                    || !argumentSchema.isObject()
                    || !"https://json-schema.org/draft/2020-12/schema"
                            .equals(argumentSchema.path("$schema").asText())
                    || !grant.path("constraints").isObject()) {
                errors.add("invalid_tool_grant:" + toolName);
            }
            if (containsSchemaReference(argumentSchema)) {
                errors.add("unsupported_tool_schema_ref:" + toolName);
            }
            if (!argumentSchema.isObject()
                    || !schemaValidator.validateToolSchema(argumentSchema).isEmpty()) {
                errors.add("invalid_tool_schema:" + toolName);
            }
        });
    }

    private boolean matchesApprovedModel(JsonNode profile) {
        Set<String> requestedCapabilities = new HashSet<>();
        profile.path("capabilities").forEach(value -> requestedCapabilities.add(value.asText()));
        return approvedModelContracts.stream().anyMatch(approved ->
                approved.profileId().equals(profile.path("model_profile_id").asText())
                        && approved.version().equals(profile.path("version").asText())
                        && approved.modelKey().equals(profile.path("model_key").asText())
                        && approved.capabilities().containsAll(requestedCapabilities)
                        && profile.path("max_input_tokens").asInt(0) <= approved.maxInputTokens()
                        && profile.path("max_output_tokens").asInt(0) <= approved.maxOutputTokens());
    }

    private boolean matchesApprovedTool(JsonNode grant) {
        return toolRegistry
                .find(grant.path("tool_name").asText(), grant.path("registry_version").asInt(0))
                .map(definition -> definition.effect().equals(grant.path("effect").asText())
                        && toolGrantScope.schemaNoWider(grant.path("argument_schema"), definition.inputSchema())
                        && toolGrantScope.constraintsNoWider(grant.path("constraints"), definition.constraints()))
                .orElse(false);
    }

    private boolean containsSchemaReference(JsonNode node) {
        if (node == null) {
            return false;
        }
        if (node.isObject()) {
            if (node.has("$ref") || node.has("$dynamicRef")) {
                return true;
            }
            return java.util.stream.StreamSupport.stream(
                            ((Iterable<JsonNode>) node::elements).spliterator(), false)
                    .anyMatch(this::containsSchemaReference);
        }
        if (node.isArray()) {
            return java.util.stream.StreamSupport.stream(node.spliterator(), false)
                    .anyMatch(this::containsSchemaReference);
        }
        return false;
    }

    private boolean containsSensitiveField(JsonNode node) {
        if (node == null) {
            return false;
        }
        if (node.isObject()) {
            var fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (SENSITIVE_FIELDS.contains(field.getKey().toLowerCase())
                        || containsSensitiveField(field.getValue())) {
                    return true;
                }
            }
        } else if (node.isArray()) {
            for (JsonNode item : node) {
                if (containsSensitiveField(item)) {
                    return true;
                }
            }
        }
        return false;
    }

    private void validateTokenBudget(ObjectNode composition, ArrayNode resources, List<String> errors) {
        JsonNode budget = composition.path("token_budget");
        int singleMax = budget.path("single_resource_max_tokens").asInt(0);
        int initialMax = budget.path("initial_context_max_tokens").asInt(0);
        int activeMax = budget.path("active_context_max_tokens").asInt(0);
        String estimator = budget.path("estimator").asText();
        if (estimator.isBlank()) {
            errors.add("invalid_token_estimator");
        } else if (!"chars_div_4".equals(estimator) || !approvedTokenEstimators.contains(estimator)) {
            errors.add("unsupported_token_estimator:" + estimator);
        }
        int initial = 0;
        for (JsonNode resource : resources) {
            int tokens = resource.path("token_estimate").asInt();
            if ("on_demand".equals(resource.path("load_mode").asText())
                    && (singleMax <= 0 || tokens > singleMax)) {
                errors.add("token_budget_exceeded:single:" + resource.path("resource_id").asText());
            }
            if ("always_on".equals(resource.path("load_mode").asText())) {
                initial += tokens;
            }
            if (Set.of("runtime_skill", "creative_skill")
                    .contains(resource.path("kind").asText())) {
                JsonNode metadata = resource.path("metadata");
                initial += estimateTokens(
                        metadata.path("name").asText() + "\n"
                                + metadata.path("description").asText());
            }
        }
        if (initialMax <= 0 || initial > initialMax) {
            errors.add("token_budget_exceeded:initial");
        }
        if (activeMax <= 0 || initial > activeMax) {
            errors.add("token_budget_exceeded:active");
        }
        if (activeMax > 0) {
            int initialTokens = initial;
            resources.forEach(resource -> {
                if ("on_demand".equals(resource.path("load_mode").asText())
                        && initialTokens + resource.path("token_estimate").asInt() > activeMax) {
                    errors.add("token_budget_exceeded:active:"
                            + resource.path("resource_id").asText());
                }
            });
        }
    }

    private int estimateTokens(String value) {
        return value.isEmpty() ? 0 : Math.max(1, (value.length() + 3) / 4);
    }

    private long countKind(ArrayNode resources, String expectedKind) {
        return java.util.stream.StreamSupport.stream(resources.spliterator(), false)
                .filter(resource -> expectedKind.equals(kind(resource)))
                .count();
    }

    private String kind(JsonNode resource) {
        return resource == null ? "" : resource.path("kind").asText();
    }

    private Set<ApprovedModelContract> configuredModelContracts(String configured) {
        Set<ApprovedModelContract> result = new HashSet<>();
        for (String entry : configured.split(",")) {
            String[] fields = entry.trim().split("\\|", -1);
            if (fields.length == 6) {
                try {
                    result.add(new ApprovedModelContract(
                            fields[0], fields[1], fields[2], Set.of(fields[3].split("\\+")),
                            Integer.parseInt(fields[4]), Integer.parseInt(fields[5])));
                } catch (IllegalArgumentException ignored) {
                    // Invalid platform catalog entries are ignored so validation fails closed.
                }
            }
        }
        return Set.copyOf(result);
    }

    private Set<String> configuredValues(String configured) {
        Set<String> result = new HashSet<>();
        for (String value : configured.split(",")) {
            if (!value.trim().isEmpty()) {
                result.add(value.trim());
            }
        }
        return Set.copyOf(result);
    }

    private record ApprovedModelContract(
            String profileId,
            String version,
            String modelKey,
            Set<String> capabilities,
            int maxInputTokens,
            int maxOutputTokens) {}

    record ValidationResult(
            List<String> errors, ObjectNode composition, ArrayNode resources, String manifestDigest) {

        boolean valid() {
            return errors.isEmpty();
        }
    }
}
