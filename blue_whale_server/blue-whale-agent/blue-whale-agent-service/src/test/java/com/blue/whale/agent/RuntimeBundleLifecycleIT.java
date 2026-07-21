package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.blue.whale.agent.runtimebundle.RuntimeBundleDigests;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.runtime-bundle.admin-user-ids=10",
        "blue-whale.runtime-bundle.worker-ids=worker-1",
        "blue-whale.runtime-bundle.approved-model-contracts="
                + "model_canvas|1.0.0|doubao-seed-1-6|text+tool_calling|100000|4096",
        "blue-whale.runtime-bundle.approved-tool-contracts="
                + "canvas.read|1|read|"
                + "eyIkc2NoZW1hIjoiaHR0cHM6Ly9qc29uLXNjaGVtYS5vcmcvZHJhZnQvMjAyMC0xMi9zY2hlbWEiLCJ0eXBlIjoib2JqZWN0IiwicHJvcGVydGllcyI6eyJsaW1pdCI6eyJ0eXBlIjoiaW50ZWdlciIsIm1heGltdW0iOjEwMH19LCJhZGRpdGlvbmFsUHJvcGVydGllcyI6ZmFsc2V9|"
                + "eyJtYXhfcmVzdWx0cyI6MTAwfQ==",
        "blue-whale.runtime-bundle.approved-token-estimators=chars_div_4"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RuntimeBundleLifecycleIT {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void publishedSnapshotsStayImmutableAndRollbackOnlyMovesTheActivePointer() throws Exception {
        createAgent("lifecycle_agent", "create-agent-lifecycle");
        createDraft("lifecycle_agent", "create-draft-lifecycle", validDraft("# Role v1\n"));

        JsonNode validation = adminJson(post("/internal/runtime-bundles/drafts/lifecycle_agent-draft/validate"),
                "validate-lifecycle-v1", "{}");
        assertThat(validation.path("data").path("validation_state").asText()).isEqualTo("valid");

        JsonNode publishedV1 = adminJson(post("/internal/runtime-bundles/drafts/lifecycle_agent-draft/publish"),
                "publish-lifecycle-v1", "{\"version\":\"1.0.0\"}");
        String versionV1 = publishedV1.path("data").path("bundle_version_id").asText();
        String digestV1 = publishedV1.path("data").path("manifest_digest").asText();
        assertThat(digestV1).startsWith("sha256:").hasSize(71);

        JsonNode immutableV1 = workerJson(get(
                "/internal/runtime-bundles/versions/{versionId}", versionV1));
        JsonNode manifestV1 = immutableV1.path("data").path("composition").path("resourceManifest");
        assertThat(manifestV1.path("baseUri").asText())
                .isEqualTo("bw-bundle://" + versionV1 + "/");
        assertThat(digestWithoutManifestDigest(manifestV1)).isEqualTo(digestV1);

        String originalSnapshot = jdbcTemplate.queryForObject("""
                SELECT snapshot_json FROM runtime_bundle_versions WHERE bundle_version_id = ?
                """, String.class, versionV1);
        ObjectNode corruptedSnapshot = (ObjectNode) objectMapper.readTree(originalSnapshot);
        ((ObjectNode) corruptedSnapshot.path("composition").path("resourceManifest"))
                .put("baseUri", "bw-bundle://tampered/");
        jdbcTemplate.update("""
                UPDATE runtime_bundle_versions SET snapshot_json = ? WHERE bundle_version_id = ?
                """, objectMapper.writeValueAsString(corruptedSnapshot), versionV1);
        JsonNode corruptedManifest = requestJsonAllowError(get(
                        "/internal/runtime-bundles/versions/{versionId}", versionV1)
                .header("X-Worker-Id", "worker-1"));
        assertThat(corruptedManifest.path("success").asBoolean()).isFalse();
        jdbcTemplate.update("""
                UPDATE runtime_bundle_versions SET snapshot_json = ? WHERE bundle_version_id = ?
                """, originalSnapshot, versionV1);

        adminJson(post("/internal/runtime-bundles/agents/lifecycle_agent/activate"),
                "activate-lifecycle-v1", "{\"bundle_version_id\":\"" + versionV1 + "\"}");

        JsonNode updated = adminJson(put("/internal/runtime-bundles/drafts/lifecycle_agent-draft"),
                "update-lifecycle-v2", validDraftUpdate(1, "# Role v2\n"));
        assertThat(updated.path("data").path("draft_revision").asInt()).isEqualTo(2);

        JsonNode immutableV1Resource = workerJson(get(
                "/internal/runtime-bundles/versions/{versionId}/resources/{resourceId}", versionV1, "role_main"));
        assertThat(immutableV1Resource.path("data").path("content").asText()).isEqualTo("# Role v1\n");
        assertThat(immutableV1Resource.path("data").path("content_digest").asText()).startsWith("sha256:");

        JsonNode diff = adminGet("/internal/runtime-bundles/drafts/lifecycle_agent-draft/diff");
        assertThat(diff.path("data").path("changed_resource_ids").toString()).contains("role_main");

        adminJson(post("/internal/runtime-bundles/drafts/lifecycle_agent-draft/validate"),
                "validate-lifecycle-v2", "{}");
        JsonNode publishedV2 = adminJson(post("/internal/runtime-bundles/drafts/lifecycle_agent-draft/publish"),
                "publish-lifecycle-v2", "{\"version\":\"2.0.0\"}");
        String versionV2 = publishedV2.path("data").path("bundle_version_id").asText();
        assertThat(publishedV2.path("data").path("manifest_digest").asText()).isNotEqualTo(digestV1);

        adminJson(post("/internal/runtime-bundles/agents/lifecycle_agent/activate"),
                "activate-lifecycle-v2", "{\"bundle_version_id\":\"" + versionV2 + "\"}");
        JsonNode rolledBack = adminJson(post("/internal/runtime-bundles/agents/lifecycle_agent/rollback"),
                "rollback-lifecycle-v1", "{\"bundle_version_id\":\"" + versionV1 + "\"}");
        assertThat(rolledBack.path("data").path("active_bundle_version_id").asText()).isEqualTo(versionV1);

        JsonNode exported = adminGet("/internal/runtime-bundles/versions/" + versionV1 + "/export");
        assertThat(exported.path("data").path("resources").get(0).has("content")).isTrue();

        createAgent("imported_agent", "create-agent-imported");
        JsonNode imported = adminJson(post("/internal/runtime-bundles/agents/imported_agent/import"),
                "import-lifecycle-v1", objectMapper.writeValueAsString(exported.path("data")));
        assertThat(imported.path("data").path("agent_definition_id").asText()).isEqualTo("imported_agent");
        assertThat(imported.path("data").path("draft_revision").asInt()).isEqualTo(1);
        String importDetails = jdbcTemplate.queryForObject("""
                SELECT details_json FROM runtime_bundle_audit_records
                WHERE operation = 'draft.imported' AND target_id = 'imported_agent-draft'
                """, String.class);
        assertThat(importDetails).contains(versionV1, digestV1, "success");

        createAgent("tampered_import_agent", "create-agent-tampered-import");
        ObjectNode tamperedPackage = exported.path("data").deepCopy();
        ((ObjectNode) tamperedPackage.path("resources").get(0)).put("content", "tampered import");
        JsonNode rejectedImport = requestJsonAllowError(post(
                        "/internal/runtime-bundles/agents/tampered_import_agent/import")
                .header("X-User-Id", "10")
                .header("Idempotency-Key", "import-tampered")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(tamperedPackage)));
        assertThat(rejectedImport.path("success").asBoolean()).isFalse();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM runtime_bundle_drafts WHERE agent_definition_id = 'tampered_import_agent'",
                Long.class)).isZero();
        String rejectedImportAudit = jdbcTemplate.queryForObject("""
                SELECT details_json FROM runtime_bundle_audit_records
                WHERE operation = 'draft.imported' AND target_id = 'tampered_import_agent'
                """, String.class);
        assertThat(rejectedImportAudit).contains("failure", "100003");

        List<String> lifecycleEvents = jdbcTemplate.queryForList("""
                SELECT operation FROM runtime_bundle_audit_records
                WHERE target_id IN (?, ?, ?)
                ORDER BY id
                """, String.class, "lifecycle_agent-draft", versionV1, "lifecycle_agent");
        assertThat(lifecycleEvents).contains(
                "draft.created", "draft.updated", "draft.validated", "version.published",
                "version.activated", "version.rolled_back", "version.exported");
        String rollbackDetails = jdbcTemplate.queryForObject("""
                SELECT details_json FROM runtime_bundle_audit_records
                WHERE operation = 'version.rolled_back' AND target_id = 'lifecycle_agent'
                """, String.class);
        assertThat(rollbackDetails).contains(versionV2, versionV1, "success");

        JsonNode rollbackToNewer = requestJsonAllowError(post(
                        "/internal/runtime-bundles/agents/lifecycle_agent/rollback")
                .header("X-User-Id", "10")
                .header("Idempotency-Key", "rollback-lifecycle-newer")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bundle_version_id\":\"" + versionV2 + "\"}"));
        assertThat(rollbackToNewer.path("success").asBoolean()).isFalse();

        jdbcTemplate.update("""
                UPDATE runtime_bundle_resources SET content = 'tampered'
                WHERE bundle_version_id = ? AND resource_id = 'role_main'
                """, versionV1);
        JsonNode corrupted = requestJsonAllowError(get(
                        "/internal/runtime-bundles/versions/{versionId}/resources/{resourceId}",
                        versionV1, "role_main")
                .header("X-Worker-Id", "worker-1"));
        assertThat(corrupted.path("success").asBoolean()).isFalse();

        JsonNode corruptedExport = requestJsonAllowError(get(
                        "/internal/runtime-bundles/versions/{versionId}/export", versionV1)
                .header("X-User-Id", "10"));
        assertThat(corruptedExport.path("success").asBoolean()).isFalse();
        String rejectedExportAudit = jdbcTemplate.queryForObject("""
                SELECT details_json FROM runtime_bundle_audit_records
                WHERE operation = 'version.exported' AND target_id = ? AND details_json LIKE '%failure%'
                """, String.class, versionV1);
        assertThat(rejectedExportAudit).contains("failure");
    }

    @Test
    void everyWriteIsIdempotentAuditedAndProtectedByRole() throws Exception {
        String body = """
                {
                  "agent_definition_id": "idempotent_agent",
                  "key": "idempotent-agent",
                  "display_name": "Idempotent Agent",
                  "description": "幂等测试"
                }
                """;
        JsonNode first = adminJson(post("/internal/runtime-bundles/agents"), "same-create-key", body);
        JsonNode replay = adminJson(post("/internal/runtime-bundles/agents"), "same-create-key", body);
        assertThat(replay.path("data")).isEqualTo(first.path("data"));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM runtime_agent_definitions WHERE agent_definition_id = 'idempotent_agent'",
                Long.class)).isEqualTo(1L);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM runtime_bundle_audit_records WHERE operation = 'agent_definition.created' "
                        + "AND target_id = 'idempotent_agent'",
                Long.class)).isEqualTo(1L);

        JsonNode conflict = requestJsonAllowError(post("/internal/runtime-bundles/agents")
                .header("X-User-Id", "10")
                .header("Idempotency-Key", "same-create-key")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.replace("Idempotent Agent", "Changed Agent")));
        assertThat(conflict.path("success").asBoolean()).isFalse();

        JsonNode denied = requestJsonAllowError(post("/internal/runtime-bundles/agents")
                .header("X-User-Id", "11")
                .header("Idempotency-Key", "denied-create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
        assertThat(denied.path("success").asBoolean()).isFalse();
        String deniedAudit = jdbcTemplate.queryForObject("""
                SELECT details_json FROM runtime_bundle_audit_records
                WHERE operation = 'agent_definition.created'
                  AND target_id = 'idempotent_agent' AND actor_user_id = 11
                ORDER BY id DESC LIMIT 1
                """, String.class);
        assertThat(deniedAudit).contains("failure", "100105");
    }

    @Test
    void invalidReferencesCyclesRulesToolsAndBudgetsAllBlockPublication() throws Exception {
        ObjectNode missingReference = validDraftNode();
        ((ArrayNode) missingReference.path("resources").get(2).path("references"))
                .add(reference("missing.md", "missing_resource"));
        assertPublicationBlocked("missing_ref_agent", missingReference, "missing_reference");

        ObjectNode cyclic = validDraftNode();
        ((ArrayNode) cyclic.path("resources").get(0).path("references"))
                .add(reference("skills/runtime/SKILL.md", "runtime_root"));
        ((ArrayNode) cyclic.path("resources").get(2).path("references"))
                .add(reference("AGENTS.md", "role_main"));
        assertPublicationBlocked("cyclic_agent", cyclic, "cyclic_dependency");

        ObjectNode conflictingRules = validDraftNode();
        ObjectNode secondRule = ((ObjectNode) conflictingRules.path("resources").get(1)).deepCopy()
                .put("resource_id", "rule_safety_two")
                .put("path", "rules/safety-two.md");
        ((ArrayNode) conflictingRules.path("resources")).add(secondRule);
        ((ArrayNode) conflictingRules.path("composition").path("rule_set").path("rules"))
                .add("rule_safety_two");
        assertPublicationBlocked("conflict_agent", conflictingRules, "conflicting_rule");

        ObjectNode unlistedRule = validDraftNode();
        ((ArrayNode) unlistedRule.path("resources")).add(
                ((ObjectNode) unlistedRule.path("resources").get(1)).deepCopy()
                        .put("resource_id", "rule_unlisted")
                        .put("path", "rules/unlisted.md")
                        .put("conflict_domain", "unlisted"));
        assertPublicationBlocked("unlisted_rule_agent", unlistedRule, "unlisted_rule");

        ObjectNode unauthorizedTool = validDraftNode();
        ((ObjectNode) unauthorizedTool.path("composition").path("tool_grants").get(0))
                .put("tool_name", "canvas.delete");
        assertPublicationBlocked("tool_agent", unauthorizedTool, "unauthorized_tool");

        ObjectNode unauthorizedModelContract = validDraftNode();
        ((ObjectNode) unauthorizedModelContract.path("composition").path("model_profiles").get(0))
                .put("max_input_tokens", 100001);
        assertPublicationBlocked(
                "model_contract_agent", unauthorizedModelContract, "unauthorized_model");

        ObjectNode overBudget = validDraftNode();
        ((ObjectNode) overBudget.path("composition").path("token_budget"))
                .put("initial_context_max_tokens", 1);
        assertPublicationBlocked("budget_agent", overBudget, "token_budget_exceeded:initial");

        ObjectNode skillMetadataBudget = validDraftNode();
        ((ObjectNode) skillMetadataBudget.path("composition").path("token_budget"))
                .put("initial_context_max_tokens", 6);
        assertPublicationBlocked(
                "skill_metadata_budget_agent", skillMetadataBudget, "token_budget_exceeded:initial");

        ObjectNode unknownEstimator = validDraftNode();
        ((ObjectNode) unknownEstimator.path("composition").path("token_budget"))
                .put("estimator", "unknown_estimator");
        assertPublicationBlocked(
                "unknown_estimator_agent", unknownEstimator, "unsupported_token_estimator");
    }

    @Test
    void schemaPathsLoadModesAndToolSchemasAllBlockPublication() throws Exception {
        ObjectNode invalid = validDraftNode();
        ArrayNode resources = (ArrayNode) invalid.path("resources");
        ObjectNode role = (ObjectNode) resources.get(0);
        role.put("load_mode", "on_demand");
        role.put("path", "../AGENTS.md");
        role.put("content_digest", "sha256:" + "0".repeat(64));

        ObjectNode runtimeSkill = (ObjectNode) resources.get(2);
        ((ObjectNode) runtimeSkill.path("metadata"))
                .remove("allow_implicit_invocation");
        ((ObjectNode) runtimeSkill.path("metadata")).put("api_key", "must-not-publish");
        ObjectNode secondRuntimeSkill = runtimeSkill.deepCopy()
                .put("resource_id", "runtime_second")
                .put("path", "skills/second/SKILL.md");
        resources.add(secondRuntimeSkill);
        ((ArrayNode) invalid.path("composition").path("rule_set").path("rules"))
                .add("rule_safety");
        ObjectNode grant = (ObjectNode) invalid.path("composition").path("tool_grants").get(0);
        grant.put("registry_version", 0);
        ((ObjectNode) grant.path("argument_schema"))
                .put("$ref", "https://example.invalid/tool.json")
                .put("required", "limit");
        ((ObjectNode) invalid.path("composition").path("model_profiles").get(0))
                .put("temperature", 0.2);

        createAgent("schema_gate_agent", "create-schema-gate-agent");
        createDraft("schema_gate_agent", "draft-schema-gate-agent",
                objectMapper.writeValueAsString(invalid));
        JsonNode validation = adminJson(post(
                        "/internal/runtime-bundles/drafts/schema_gate_agent-draft/validate"),
                "validate-schema-gate-agent", "{}");
        String errors = validation.path("data").path("errors").toString();
        assertThat(validation.path("data").path("validation_state").asText()).isEqualTo("invalid");
        assertThat(errors).contains(
                "invalid_resource_path", "content_digest_mismatch", "invalid_load_mode",
                "invalid_root_runtime_skill", "invalid_skill_metadata", "duplicate_rule",
                "invalid_tool_grant", "unsupported_tool_schema_ref", "sensitive_configuration",
                "invalid_tool_schema", "unknown_skill_metadata_field", "unknown_model_profile_field");
    }

    @Test
    void changingPublishedResourceContentRequiresHigherRevision() throws Exception {
        createAgent("resource_revision_agent", "create-resource-revision-agent");
        createDraft("resource_revision_agent", "draft-resource-revision-agent", validDraft("# Role v1\n"));
        adminJson(post("/internal/runtime-bundles/drafts/resource_revision_agent-draft/validate"),
                "validate-resource-revision-v1", "{}");
        adminJson(post("/internal/runtime-bundles/drafts/resource_revision_agent-draft/publish"),
                "publish-resource-revision-v1", "{\"version\":\"1.0.0\"}");

        adminJson(put("/internal/runtime-bundles/drafts/resource_revision_agent-draft"),
                "update-resource-revision-v2", validDraftUpdate(1, "# Role v2\n", 1));
        JsonNode validation = adminJson(post(
                        "/internal/runtime-bundles/drafts/resource_revision_agent-draft/validate"),
                "validate-resource-revision-v2", "{}");

        assertThat(validation.path("data").path("validation_state").asText()).isEqualTo("invalid");
        assertThat(validation.path("data").path("errors").toString())
                .contains("resource_revision_content_changed:role_main:1");

        ObjectNode metadataOnlyUpdate = (ObjectNode) objectMapper.readTree(
                validDraftUpdate(2, "# Role v1\n", 1));
        ((ObjectNode) metadataOnlyUpdate.path("resources").get(0))
                .put("path", "roles/AGENTS.md");
        adminJson(put("/internal/runtime-bundles/drafts/resource_revision_agent-draft"),
                "update-resource-metadata-v3", objectMapper.writeValueAsString(metadataOnlyUpdate));
        JsonNode metadataValidation = adminJson(post(
                        "/internal/runtime-bundles/drafts/resource_revision_agent-draft/validate"),
                "validate-resource-metadata-v3", "{}");
        assertThat(metadataValidation.path("data").path("validation_state").asText())
                .isEqualTo("invalid");
        assertThat(metadataValidation.path("data").path("errors").toString())
                .contains("resource_revision_metadata_changed:role_main:1");
    }

    @Test
    void versionIdentityDoesNotCollideWhenSemanticVersionPunctuationDiffers() throws Exception {
        createAgent("version_identity_agent", "create-version-identity-agent");
        createDraft("version_identity_agent", "draft-version-identity-agent", validDraft("# Role\n"));
        adminJson(post("/internal/runtime-bundles/drafts/version_identity_agent-draft/validate"),
                "validate-version-identity-v1", "{}");
        JsonNode first = adminJson(post(
                        "/internal/runtime-bundles/drafts/version_identity_agent-draft/publish"),
                "publish-version-identity-v1", "{\"version\":\"1.0.0-alpha\"}");

        adminJson(put("/internal/runtime-bundles/drafts/version_identity_agent-draft"),
                "update-version-identity-v2", validDraftUpdate(1, "# Role\n"));
        adminJson(post("/internal/runtime-bundles/drafts/version_identity_agent-draft/validate"),
                "validate-version-identity-v2", "{}");
        JsonNode second = adminJson(post(
                        "/internal/runtime-bundles/drafts/version_identity_agent-draft/publish"),
                "publish-version-identity-v2", "{\"version\":\"1.0.0+alpha\"}");

        assertThat(second.path("success").asBoolean()).isTrue();
        assertThat(second.path("data").path("bundle_version_id").asText())
                .isNotEqualTo(first.path("data").path("bundle_version_id").asText());
    }

    @Test
    void diffReportsCompositionChangesWithoutResourceChanges() throws Exception {
        createAgent("composition_diff_agent", "create-composition-diff-agent");
        createDraft("composition_diff_agent", "draft-composition-diff-agent", validDraft("# Role\n"));
        adminJson(post("/internal/runtime-bundles/drafts/composition_diff_agent-draft/validate"),
                "validate-composition-diff-v1", "{}");
        adminJson(post("/internal/runtime-bundles/drafts/composition_diff_agent-draft/publish"),
                "publish-composition-diff-v1", "{\"version\":\"1.0.0\"}");

        ObjectNode update = validDraftNode();
        ((ObjectNode) update.path("composition").path("model_profiles").get(0))
                .put("max_output_tokens", 2048);
        update.put("expected_revision", 1);
        adminJson(put("/internal/runtime-bundles/drafts/composition_diff_agent-draft"),
                "update-composition-diff-v2", objectMapper.writeValueAsString(update));

        JsonNode diff = adminGet("/internal/runtime-bundles/drafts/composition_diff_agent-draft/diff");
        assertThat(diff.path("data").path("composition_changed").asBoolean()).isTrue();
        assertThat(diff.path("data").path("changed_resource_ids")).isEmpty();
    }

    @Test
    void publishRejectsInvalidSemanticVersion() throws Exception {
        createAgent("semver_agent", "create-semver-agent");
        createDraft("semver_agent", "draft-semver-agent", validDraft("# Role\n"));
        adminJson(post("/internal/runtime-bundles/drafts/semver_agent-draft/validate"),
                "validate-semver-agent", "{}");

        JsonNode rejected = requestJsonAllowError(post(
                        "/internal/runtime-bundles/drafts/semver_agent-draft/publish")
                .header("X-User-Id", "10")
                .header("Idempotency-Key", "publish-invalid-semver")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":\"latest\"}"));

        assertThat(rejected.path("success").asBoolean()).isFalse();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM runtime_bundle_versions WHERE agent_definition_id = 'semver_agent'",
                Long.class)).isZero();
        String failureAudit = jdbcTemplate.queryForObject("""
                SELECT details_json FROM runtime_bundle_audit_records
                WHERE operation = 'version.published' AND target_id = 'semver_agent-draft'
                """, String.class);
        assertThat(failureAudit).contains("failure", "100003");
    }

    private void createAgent(String agentDefinitionId, String idempotencyKey) throws Exception {
        adminJson(post("/internal/runtime-bundles/agents"), idempotencyKey, """
                {
                  "agent_definition_id": "%s",
                  "key": "%s",
                  "display_name": "Runtime Agent",
                  "description": "Runtime Bundle lifecycle test"
                }
                """.formatted(agentDefinitionId, agentDefinitionId.replace('_', '-')));
    }

    private void createDraft(String agentDefinitionId, String idempotencyKey, String body) throws Exception {
        adminJson(post("/internal/runtime-bundles/agents/{agentDefinitionId}/drafts", agentDefinitionId),
                idempotencyKey, body);
    }

    private void assertPublicationBlocked(String agentDefinitionId, ObjectNode draft, String expectedError)
            throws Exception {
        createAgent(agentDefinitionId, "create-" + agentDefinitionId);
        createDraft(agentDefinitionId, "draft-" + agentDefinitionId,
                objectMapper.writeValueAsString(draft));
        JsonNode validation = adminJson(post(
                        "/internal/runtime-bundles/drafts/{draftId}/validate", agentDefinitionId + "-draft"),
                "validate-" + agentDefinitionId, "{}");
        assertThat(validation.path("data").path("validation_state").asText()).isEqualTo("invalid");
        assertThat(validation.path("data").path("errors").toString()).contains(expectedError);

        JsonNode publish = requestJsonAllowError(post(
                        "/internal/runtime-bundles/drafts/{draftId}/publish", agentDefinitionId + "-draft")
                .header("X-User-Id", "10")
                .header("Idempotency-Key", "publish-" + agentDefinitionId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":\"1.0.0\"}"));
        assertThat(publish.path("success").asBoolean()).isFalse();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM runtime_bundle_versions WHERE agent_definition_id = ?",
                Long.class, agentDefinitionId)).isZero();
    }

    private ObjectNode validDraftNode() throws Exception {
        return (ObjectNode) objectMapper.readTree(validDraft("# Role\n"));
    }

    private ObjectNode reference(String rawRef, String resolvedResourceId) {
        return objectMapper.createObjectNode()
                .put("raw_ref", rawRef)
                .put("resolved_resource_id", resolvedResourceId);
    }

    private JsonNode adminJson(MockHttpServletRequestBuilder request, String idempotencyKey, String body)
            throws Exception {
        return requestJson(request
                .header("X-User-Id", "10")
                .header("Idempotency-Key", idempotencyKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private JsonNode adminGet(String path) throws Exception {
        return requestJson(get(path).header("X-User-Id", "10"));
    }

    private JsonNode workerJson(MockHttpServletRequestBuilder request) throws Exception {
        return requestJson(request.header("X-Worker-Id", "worker-1"));
    }

    private JsonNode requestJson(MockHttpServletRequestBuilder request) throws Exception {
        String content = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(content);
    }

    private JsonNode requestJsonAllowError(MockHttpServletRequestBuilder request) throws Exception {
        return objectMapper.readTree(mockMvc.perform(request)
                .andReturn()
                .getResponse()
                .getContentAsString());
    }

    private String validDraft(String roleContent) {
        return """
                {
                  "composition": %s,
                  "resources": %s
                }
                """.formatted(validComposition(), validResources(roleContent, 1));
    }

    private String validDraftUpdate(int expectedRevision, String roleContent) {
        return validDraftUpdate(expectedRevision, roleContent, 2);
    }

    private String validDraftUpdate(int expectedRevision, String roleContent, int roleRevision) {
        return """
                {
                  "expected_revision": %d,
                  "composition": %s,
                  "resources": %s
                }
                """.formatted(expectedRevision, validComposition(), validResources(roleContent, roleRevision));
    }

    private String validComposition() {
        return """
                {
                  "role_document_id": "role_main",
                  "rule_set": {"rules": ["rule_safety"]},
                  "root_runtime_skill_id": "runtime_root",
                  "model_profiles": [{
                    "model_profile_id": "model_canvas",
                    "version": "1.0.0",
                    "model_key": "doubao-seed-1-6",
                    "capabilities": ["text", "tool_calling"],
                    "max_input_tokens": 100000,
                    "max_output_tokens": 4096
                  }],
                  "tool_grants": [{
                    "tool_name": "canvas.read",
                    "registry_version": 1,
                    "effect": "read",
                    "proposal_only": true,
                    "argument_schema": {
                      "$schema": "https://json-schema.org/draft/2020-12/schema",
                      "type": "object",
                      "properties": {"limit": {"type": "integer", "maximum": 50}},
                      "additionalProperties": false
                    },
                    "constraints": {"max_results": 50}
                  }],
                  "token_budget": {
                    "estimator": "chars_div_4",
                    "initial_context_max_tokens": 100,
                    "single_resource_max_tokens": 100,
                    "active_context_max_tokens": 300
                  }
                }
                """;
    }

    private String validResources(String roleContent, int roleRevision) {
        try {
            ObjectNode role = (ObjectNode) resource(
                    "role_main", "role_document", "AGENTS.md", "always_on", roleContent);
            role.put("revision", roleRevision);
            return objectMapper.writeValueAsString(new Object[] {
                    role,
                    rule("rule_safety", "rules/safety.md", "always_on", "Safety first.\n", "safety"),
                    runtimeSkill("runtime_root", "skills/runtime/SKILL.md", "# Runtime\n")
            });
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private Object resource(String id, String kind, String path, String loadMode, String content) {
        com.fasterxml.jackson.databind.node.ObjectNode resource = objectMapper.createObjectNode()
                .put("resource_id", id)
                .put("revision", 1)
                .put("kind", kind)
                .put("path", path)
                .put("media_type", "text/markdown")
                .put("load_mode", loadMode);
        resource.set("references", objectMapper.createArrayNode());
        return resource.put("content", content);
    }

    private Object rule(String id, String path, String loadMode, String content, String conflictDomain) {
        return ((com.fasterxml.jackson.databind.node.ObjectNode) resource(
                id, "rule", path, loadMode, content)).put("conflict_domain", conflictDomain);
    }

    private Object runtimeSkill(String id, String path, String content) {
        return ((com.fasterxml.jackson.databind.node.ObjectNode) resource(
                id, "runtime_skill", path, "on_demand", content))
                .set("metadata", objectMapper.createObjectNode()
                        .put("name", "runtime")
                        .put("description", "Runtime root skill")
                        .put("allow_implicit_invocation", false));
    }

    private String digestWithoutManifestDigest(JsonNode manifest) {
        ObjectNode withoutDigest = manifest.deepCopy();
        withoutDigest.remove("manifestDigest");
        return new RuntimeBundleDigests(objectMapper).canonicalJson(withoutDigest);
    }
}
