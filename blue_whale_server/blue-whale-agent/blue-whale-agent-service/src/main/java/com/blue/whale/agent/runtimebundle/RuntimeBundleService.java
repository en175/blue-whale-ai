package com.blue.whale.agent.runtimebundle;

import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RuntimeBundleService {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final RuntimeBundleValidator validator;
    private final RuntimeBundleDigests digests;
    private final RuntimeBundleContractMapper contractMapper;
    private final RuntimeBundleSchemaValidator schemaValidator;
    private final RuntimeBundleFailureAuditWriter failureAuditWriter;
    private final RuntimeBundleAccessPolicy accessPolicy;

    @Transactional
    public RuntimeBundleApi.AgentDefinitionResponse createAgent(
            RuntimeBundleApi.CreateAgentRequest request, Long actorUserId, String idempotencyKey) {
        return idempotent("CREATE_AGENT", idempotencyKey, actorUserId, request,
                RuntimeBundleApi.AgentDefinitionResponse.class, () -> {
                    requireText(request.agentDefinitionId(), "agent_definition_id");
                    requireText(request.key(), "key");
                    requireText(request.displayName(), "display_name");
                    requireText(request.description(), "description");
                    try {
                        jdbcTemplate.update("""
                                INSERT INTO runtime_agent_definitions
                                    (agent_definition_id, definition_key, display_name, description)
                                VALUES (?, ?, ?, ?)
                                """, request.agentDefinitionId(), request.key(),
                                request.displayName(), request.description());
                    } catch (DuplicateKeyException exception) {
                        throw new GlobalException(SystemCode.DATA_EXISTED_CODE, "AgentDefinition 已存在");
                    }
                    audit(actorUserId, "agent_definition.created", "agent_definition",
                            request.agentDefinitionId(), objectMapper.createObjectNode());
                    return new RuntimeBundleApi.AgentDefinitionResponse(
                            request.agentDefinitionId(), request.key(), request.displayName(),
                            request.description(), null);
                });
    }

    @Transactional
    public RuntimeBundleApi.DraftResponse createDraft(
            String agentDefinitionId,
            RuntimeBundleApi.CreateDraftRequest request,
            Long actorUserId,
            String idempotencyKey) {
        return idempotent("CREATE_DRAFT", idempotencyKey, actorUserId,
                Map.of("agent_definition_id", agentDefinitionId, "request", request),
                RuntimeBundleApi.DraftResponse.class, () -> {
                    requireAgent(agentDefinitionId);
                    String draftId = agentDefinitionId + "-draft";
                    insertDraft(draftId, agentDefinitionId, request.baseVersionId(),
                            request.composition(), request.resources(), actorUserId);
                    audit(actorUserId, "draft.created", "bundle_draft", draftId,
                            objectMapper.createObjectNode()
                                    .put("agent_definition_id", agentDefinitionId)
                                    .put("draft_revision", 1));
                    return readDraft(draftId);
                });
    }

    @Transactional
    public RuntimeBundleApi.DraftResponse updateDraft(
            String draftId,
            RuntimeBundleApi.UpdateDraftRequest request,
            Long actorUserId,
            String idempotencyKey) {
        return idempotent("UPDATE_DRAFT", idempotencyKey, actorUserId,
                Map.of("draft_id", draftId, "request", request),
                RuntimeBundleApi.DraftResponse.class, () -> {
                    int updated = jdbcTemplate.update("""
                            UPDATE runtime_bundle_drafts
                            SET draft_revision = draft_revision + 1,
                                validation_state = 'editing', last_validated_revision = NULL,
                                composition_json = ?, resources_json = ?, updated_by = ?,
                                gmt_modified = CURRENT_TIMESTAMP
                            WHERE draft_id = ? AND draft_revision = ?
                            """, writeJson(request.composition()), writeJson(request.resources()),
                            actorUserId, draftId, request.expectedRevision());
                    if (updated != 1) {
                        throw conflict("BundleDraft 修订版本已变化");
                    }
                    audit(actorUserId, "draft.updated", "bundle_draft", draftId,
                            objectMapper.createObjectNode()
                                    .put("draft_revision", request.expectedRevision() + 1));
                    return readDraft(draftId);
                });
    }

    public RuntimeBundleApi.DraftResponse readDraft(String draftId) {
        return readDraft(draftId, false);
    }

    private RuntimeBundleApi.DraftResponse readDraft(String draftId, boolean forUpdate) {
        String sql = """
                SELECT draft_id, agent_definition_id, base_version_id, draft_revision,
                       validation_state, last_validated_revision, composition_json, resources_json
                FROM runtime_bundle_drafts WHERE draft_id = ?
                """ + (forUpdate ? " FOR UPDATE" : "");
        List<RuntimeBundleApi.DraftResponse> rows = jdbcTemplate.query(
                sql, (resultSet, rowNumber) -> new RuntimeBundleApi.DraftResponse(
                        resultSet.getString("draft_id"),
                        resultSet.getString("agent_definition_id"),
                        resultSet.getString("base_version_id"),
                        resultSet.getInt("draft_revision"),
                        resultSet.getString("validation_state"),
                        (Integer) resultSet.getObject("last_validated_revision"),
                        readJson(resultSet.getString("composition_json")),
                        readJson(resultSet.getString("resources_json"))), draftId);
        if (rows.isEmpty()) {
            throw notFound("BundleDraft 不存在");
        }
        return rows.get(0);
    }

    @Transactional
    public JsonNode validateDraft(String draftId, Long actorUserId, String idempotencyKey) {
        return idempotent("VALIDATE_DRAFT", idempotencyKey, actorUserId,
                Map.of("draft_id", draftId),
                JsonNode.class, () -> {
                    RuntimeBundleApi.DraftResponse draft = readDraft(draftId);
                    RuntimeBundleValidator.ValidationResult validation =
                            validator.validate(draft.composition(), draft.resources());
                    validation = validatePublishedResourceRevisions(
                            draft.agentDefinitionId(), validation);
                    String state = validation.valid() ? "valid" : "invalid";
                    jdbcTemplate.update("""
                            UPDATE runtime_bundle_drafts
                            SET validation_state = ?, last_validated_revision = ?,
                                composition_json = ?, resources_json = ?, updated_by = ?,
                                gmt_modified = CURRENT_TIMESTAMP
                            WHERE draft_id = ? AND draft_revision = ?
                            """, state, draft.draftRevision(), writeJson(validation.composition()),
                            writeJson(validation.resources()), actorUserId, draftId, draft.draftRevision());
                    ObjectNode auditDetails = objectMapper.createObjectNode()
                            .put("draft_revision", draft.draftRevision())
                            .put("validation_state", state)
                            .put("manifest_digest", validation.manifestDigest());
                    auditDetails.set("error_codes", objectMapper.valueToTree(validation.errors()));
                    audit(actorUserId, "draft.validated", "bundle_draft", draftId, auditDetails);
                    ObjectNode response = objectMapper.createObjectNode()
                            .put("draft_id", draftId)
                            .put("draft_revision", draft.draftRevision())
                            .put("validation_state", state)
                            .put("manifest_digest", validation.manifestDigest());
                    response.set("errors", objectMapper.valueToTree(validation.errors()));
                    return response;
                });
    }

    @Transactional
    public JsonNode publish(
            String draftId, RuntimeBundleApi.PublishRequest request, Long actorUserId, String idempotencyKey) {
        return idempotent("PUBLISH_BUNDLE", idempotencyKey, actorUserId,
                Map.of("draft_id", draftId, "request", request), JsonNode.class, () -> {
                    RuntimeBundleApi.DraftResponse draft = readDraft(draftId, true);
                    if (!"valid".equals(draft.validationState())
                            || draft.lastValidatedRevision() == null
                            || draft.lastValidatedRevision() != draft.draftRevision()) {
                        throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                                "只能发布通过当前修订静态校验的 BundleDraft");
                    }
                    requireText(request.version(), "version");
                    if (!validator.validSemanticVersion(request.version())) {
                        throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "Bundle 版本必须是合法 SemVer");
                    }
                    String bundleVersionId = versionId(
                            draft.agentDefinitionId(), draft.draftId(),
                            draft.draftRevision(), request.version());
                    RuntimeBundleValidator.ValidationResult validation = validator.validate(
                            draft.composition(), draft.resources(),
                            "bw-bundle://" + bundleVersionId + "/");
                    validation = validatePublishedResourceRevisions(
                            draft.agentDefinitionId(), validation);
                    if (!validation.valid()) {
                        throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                                "BundleDraft 静态校验未通过: " + String.join(",", validation.errors()));
                    }

                    RuntimeBundleApi.AgentDefinitionResponse agent = readAgent(draft.agentDefinitionId());
                    String publishedAt = Instant.now().toString();
                    ObjectNode composition = validation.composition().deepCopy();
                    ObjectNode snapshot = objectMapper.createObjectNode()
                            .put("kind", "bundle_version")
                            .put("schemaVersion", 1)
                            .put("bundleVersionId", bundleVersionId)
                            .put("version", request.version())
                            .put("publishedAt", publishedAt)
                            .put("publishedBy", "user_" + actorUserId);
                    snapshot.set("agentDefinition", objectMapper.createObjectNode()
                            .put("agentDefinitionId", agent.agentDefinitionId())
                            .put("key", agent.key())
                            .put("displayName", agent.displayName())
                            .put("description", agent.description()));
                    snapshot.set("composition", contractMapper.publishedComposition(composition));
                    List<String> schemaErrors = schemaValidator.validate(snapshot);
                    if (!schemaErrors.isEmpty()) {
                        throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                                "BundleVersion 不满足契约 Schema: " + String.join(",", schemaErrors));
                    }
                    try {
                        jdbcTemplate.update("""
                                INSERT INTO runtime_bundle_versions
                                    (bundle_version_id, agent_definition_id, semantic_version,
                                     source_draft_id, source_draft_revision, manifest_digest,
                                     snapshot_json, published_by, published_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                                """, bundleVersionId, draft.agentDefinitionId(), request.version(), draftId,
                                draft.draftRevision(), validation.manifestDigest(), writeJson(snapshot), actorUserId);
                        insertPublishedResources(bundleVersionId, validation.resources());
                    } catch (DuplicateKeyException exception) {
                        throw new GlobalException(SystemCode.DATA_EXISTED_CODE, "BundleVersion 已存在");
                    }
                    int linked = jdbcTemplate.update("""
                            UPDATE runtime_bundle_drafts SET base_version_id = ?, gmt_modified = CURRENT_TIMESTAMP
                            WHERE draft_id = ? AND draft_revision = ?
                            """, bundleVersionId, draftId, draft.draftRevision());
                    if (linked != 1) {
                        throw conflict("BundleDraft 修订版本已变化");
                    }
                    audit(actorUserId, "version.published", "bundle_version", bundleVersionId,
                            objectMapper.createObjectNode()
                                    .put("agent_definition_id", draft.agentDefinitionId())
                                    .put("draft_id", draftId)
                                    .put("draft_revision", draft.draftRevision())
                                    .put("manifest_digest", validation.manifestDigest()));
                    return objectMapper.createObjectNode()
                            .put("bundle_version_id", bundleVersionId)
                            .put("agent_definition_id", draft.agentDefinitionId())
                            .put("version", request.version())
                            .put("manifest_digest", validation.manifestDigest())
                            .put("published_at", publishedAt);
                });
    }

    @Transactional
    public RuntimeBundleApi.AgentDefinitionResponse activate(
            String agentDefinitionId,
            RuntimeBundleApi.VersionPointerRequest request,
            Long actorUserId,
            String idempotencyKey,
            boolean rollback) {
        String operation = rollback ? "ROLLBACK_BUNDLE" : "ACTIVATE_BUNDLE";
        return idempotent(operation, idempotencyKey, actorUserId,
                Map.of("agent_definition_id", agentDefinitionId, "request", request),
                RuntimeBundleApi.AgentDefinitionResponse.class, () -> {
                    requireVersionForAgent(request.bundleVersionId(), agentDefinitionId);
                    RuntimeBundleApi.AgentDefinitionResponse before = readAgent(agentDefinitionId);
                    if (rollback) {
                        requireRollbackTargetOlder(before.activeBundleVersionId(),
                                request.bundleVersionId());
                    }
                    int updated = jdbcTemplate.update("""
                            UPDATE runtime_agent_definitions
                            SET active_bundle_version_id = ?, gmt_modified = CURRENT_TIMESTAMP
                            WHERE agent_definition_id = ?
                            """, request.bundleVersionId(), agentDefinitionId);
                    if (updated != 1) {
                        throw notFound("AgentDefinition 不存在");
                    }
                    String event = rollback ? "version.rolled_back" : "version.activated";
                    audit(actorUserId, event, "agent_definition", agentDefinitionId,
                            objectMapper.createObjectNode()
                                    .put("from_bundle_version_id", before.activeBundleVersionId())
                                    .put("to_bundle_version_id", request.bundleVersionId())
                                    .put("manifest_digest", manifestDigest(request.bundleVersionId())));
                    return readAgent(agentDefinitionId);
                });
    }

    private void requireRollbackTargetOlder(String currentVersionId, String targetVersionId) {
        if (currentVersionId == null || currentVersionId.isBlank()) {
            throw conflict("AgentDefinition 尚无已激活 BundleVersion，无法回滚");
        }
        Long currentSequence = versionSequence(currentVersionId);
        Long targetSequence = versionSequence(targetVersionId);
        if (currentSequence == null || targetSequence == null
                || targetSequence >= currentSequence) {
            throw conflict("回滚目标必须是更早发布的 BundleVersion");
        }
    }

    private Long versionSequence(String bundleVersionId) {
        return jdbcTemplate.queryForObject("""
                SELECT id FROM runtime_bundle_versions WHERE bundle_version_id = ?
                """, Long.class, bundleVersionId);
    }

    public JsonNode readVersion(String bundleVersionId) {
        List<StoredVersion> rows = jdbcTemplate.query("""
                SELECT snapshot_json, manifest_digest
                FROM runtime_bundle_versions WHERE bundle_version_id = ?
                """, (resultSet, rowNumber) -> new StoredVersion(
                        readJson(resultSet.getString("snapshot_json")),
                        resultSet.getString("manifest_digest")), bundleVersionId);
        if (rows.isEmpty()) {
            throw notFound("BundleVersion 不存在");
        }
        StoredVersion stored = rows.get(0);
        verifyManifestDigest(stored.snapshot(), stored.manifestDigest());
        return stored.snapshot();
    }

    public JsonNode readResource(String bundleVersionId, String resourceId) {
        List<JsonNode> rows = jdbcTemplate.query("""
                SELECT metadata_json, content FROM runtime_bundle_resources
                WHERE bundle_version_id = ? AND resource_id = ?
                """, (resultSet, rowNumber) -> verifiedResource(
                        resultSet.getString("metadata_json"), resultSet.getString("content")),
                bundleVersionId, resourceId);
        if (rows.isEmpty()) {
            throw notFound("BundleVersion 资源不存在");
        }
        return rows.get(0);
    }

    private ObjectNode verifiedResource(String metadataJson, String content) {
        ObjectNode resource = (ObjectNode) readJson(metadataJson);
        if (!digests.content(content).equals(resource.path("content_digest").asText())) {
            throw conflict("BundleVersion 资源内容摘要不一致");
        }
        resource.put("content", content);
        return resource;
    }

    public JsonNode diff(String draftId) {
        RuntimeBundleApi.DraftResponse draft = readDraft(draftId);
        RuntimeBundleValidator.ValidationResult normalized =
                validator.validate(draft.composition(), draft.resources());
        Map<String, String> draftDigests = resourceDigests(normalized.resources());
        Map<String, String> baseDigests = new HashMap<>();
        JsonNode baseComposition = null;
        if (draft.baseVersionId() != null) {
            baseComposition = readVersion(draft.baseVersionId()).path("composition");
            jdbcTemplate.query("""
                    SELECT resource_id, content_digest FROM runtime_bundle_resources
                    WHERE bundle_version_id = ?
                    """, resultSet -> {
                        baseDigests.put(resultSet.getString("resource_id"),
                                resultSet.getString("content_digest"));
                    },
                    draft.baseVersionId());
        }
        ArrayNode added = objectMapper.createArrayNode();
        ArrayNode removed = objectMapper.createArrayNode();
        ArrayNode changed = objectMapper.createArrayNode();
        draftDigests.forEach((resourceId, digest) -> {
            if (!baseDigests.containsKey(resourceId)) {
                added.add(resourceId);
            } else if (!digest.equals(baseDigests.get(resourceId))) {
                changed.add(resourceId);
            }
        });
        baseDigests.keySet().stream().filter(resourceId -> !draftDigests.containsKey(resourceId))
                .forEach(removed::add);
        ObjectNode response = objectMapper.createObjectNode()
                .put("draft_id", draftId)
                .put("base_version_id", draft.baseVersionId());
        ObjectNode draftComposition = contractMapper.publishedComposition(normalized.composition());
        draftComposition.remove("resourceManifest");
        ObjectNode comparableBaseComposition = baseComposition != null && baseComposition.isObject()
                ? ((ObjectNode) baseComposition.deepCopy())
                : objectMapper.createObjectNode();
        comparableBaseComposition.remove("resourceManifest");
        ArrayNode changedCompositionFields = objectMapper.createArrayNode();
        Set<String> compositionFields = new java.util.TreeSet<>();
        draftComposition.fieldNames().forEachRemaining(compositionFields::add);
        comparableBaseComposition.fieldNames().forEachRemaining(compositionFields::add);
        compositionFields.stream()
                .filter(field -> !digests.canonicalJson(draftComposition.path(field))
                        .equals(digests.canonicalJson(comparableBaseComposition.path(field))))
                .forEach(changedCompositionFields::add);
        response.put("composition_changed", !changedCompositionFields.isEmpty());
        response.set("changed_composition_fields", changedCompositionFields);
        response.set("added_resource_ids", added);
        response.set("removed_resource_ids", removed);
        response.set("changed_resource_ids", changed);
        return response;
    }

    @Transactional
    public JsonNode exportVersion(String bundleVersionId, Long actorUserId) {
        try {
            accessPolicy.requireAdmin(actorUserId);
            JsonNode snapshot = readVersion(bundleVersionId);
            ObjectNode exported = objectMapper.createObjectNode()
                    .put("format_version", 1)
                    .put("bundle_version_id", bundleVersionId)
                    .put("source_agent_definition_id",
                            snapshot.path("agentDefinition").path("agentDefinitionId").asText());
            exported.set("composition", snapshot.path("composition").deepCopy());
            ArrayNode resources = objectMapper.createArrayNode();
            jdbcTemplate.query("""
                    SELECT metadata_json, content FROM runtime_bundle_resources
                    WHERE bundle_version_id = ? ORDER BY resource_id
                    """, resultSet -> {
                        resources.add(verifiedResource(
                                resultSet.getString("metadata_json"), resultSet.getString("content")));
                    }, bundleVersionId);
            exported.set("resources", resources);
            audit(actorUserId, "version.exported", "bundle_version", bundleVersionId,
                    objectMapper.createObjectNode()
                            .put("agent_definition_id",
                                    snapshot.path("agentDefinition").path("agentDefinitionId").asText())
                            .put("manifest_digest", manifestDigest(bundleVersionId)));
            return exported;
        } catch (RuntimeException exception) {
            int errorCode = exception instanceof GlobalException globalException
                    ? globalException.getCode()
                    : SystemCode.FAILURE_CODE;
            failureAuditWriter.record(actorUserId, "version.exported", "bundle_version",
                    bundleVersionId, digests.canonicalJson(objectMapper.valueToTree(bundleVersionId)), errorCode);
            throw exception;
        }
    }

    @Transactional
    public RuntimeBundleApi.DraftResponse importBundle(
            String agentDefinitionId, JsonNode bundlePackage, Long actorUserId, String idempotencyKey) {
        return idempotent("IMPORT_BUNDLE", idempotencyKey, actorUserId,
                Map.of("agent_definition_id", agentDefinitionId, "bundle", bundlePackage),
                RuntimeBundleApi.DraftResponse.class, () -> {
                    requireAgent(agentDefinitionId);
                    if (bundlePackage == null || !bundlePackage.isObject()
                            || bundlePackage.path("format_version").asInt(0) != 1) {
                        throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                                "导入包格式版本无效");
                    }
                    JsonNode compositionValue = bundlePackage.path("composition");
                    ObjectNode composition = compositionValue.isObject()
                            ? contractMapper.draftComposition(compositionValue)
                            : objectMapper.createObjectNode();
                    JsonNode suppliedManifest = compositionValue.path("resourceManifest").deepCopy();
                    String originBundleVersionId = bundlePackage.path("bundle_version_id").asText();
                    String originManifestDigest = suppliedManifest.path("manifestDigest").asText();
                    String originBaseUri = suppliedManifest.path("baseUri").asText();
                    if (originBundleVersionId.isBlank()
                            || !originBaseUri.equals("bw-bundle://" + originBundleVersionId + "/")) {
                        throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                                "导入包来源身份无效");
                    }
                    JsonNode resources = bundlePackage.path("resources");
                    RuntimeBundleValidator.ValidationResult validation =
                            validator.validate(composition, resources, originBaseUri);
                    validation = validatePublishedResourceRevisions(agentDefinitionId, validation);
                    JsonNode recomputedManifest = validation.composition().path("resource_manifest");
                    boolean sameManifest = digests.canonicalJson(suppliedManifest)
                            .equals(digests.canonicalJson(recomputedManifest));
                    if (!validation.valid()
                            || !originManifestDigest.equals(validation.manifestDigest())
                            || !sameManifest) {
                        throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE,
                                "导入包静态校验或摘要校验未通过: "
                                        + String.join(",", validation.errors()));
                    }
                    ObjectNode normalizedComposition = validation.composition().deepCopy();
                    normalizedComposition.remove("resource_manifest");
                    String draftId = agentDefinitionId + "-draft";
                    insertDraft(draftId, agentDefinitionId, null, normalizedComposition,
                            validation.resources(), actorUserId);
                    audit(actorUserId, "draft.imported", "bundle_draft", draftId,
                            objectMapper.createObjectNode()
                                    .put("agent_definition_id", agentDefinitionId)
                                    .put("origin_bundle_version_id", originBundleVersionId)
                                    .put("origin_manifest_digest", originManifestDigest));
                    return readDraft(draftId);
                });
    }

    private void insertDraft(
            String draftId,
            String agentDefinitionId,
            String baseVersionId,
            JsonNode composition,
            Object resources,
            Long actorUserId) {
        try {
            jdbcTemplate.update("""
                    INSERT INTO runtime_bundle_drafts
                        (draft_id, agent_definition_id, base_version_id, draft_revision,
                         validation_state, composition_json, resources_json, created_by, updated_by)
                    VALUES (?, ?, ?, 1, 'editing', ?, ?, ?, ?)
                    """, draftId, agentDefinitionId, baseVersionId, writeJson(composition),
                    writeJson(resources), actorUserId, actorUserId);
        } catch (DuplicateKeyException exception) {
            throw new GlobalException(SystemCode.DATA_EXISTED_CODE, "BundleDraft 已存在");
        }
    }

    private void insertPublishedResources(String bundleVersionId, ArrayNode resources) {
        resources.forEach(resource -> {
            ObjectNode metadata = (ObjectNode) resource.deepCopy();
            String content = metadata.path("content").asText();
            metadata.remove("content");
            jdbcTemplate.update("""
                    INSERT INTO runtime_bundle_resources
                        (bundle_version_id, resource_id, resource_revision, resource_kind,
                         resource_path, media_type, load_mode, content_digest, size_bytes,
                         token_estimate, metadata_json, content)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, bundleVersionId, metadata.path("resource_id").asText(),
                    metadata.path("revision").asInt(), metadata.path("kind").asText(),
                    metadata.path("path").asText(),
                    metadata.path("media_type").asText(), metadata.path("load_mode").asText(),
                    metadata.path("content_digest").asText(), metadata.path("size_bytes").asLong(),
                    metadata.path("token_estimate").asInt(), writeJson(metadata), content);
        });
    }

    private RuntimeBundleValidator.ValidationResult validatePublishedResourceRevisions(
            String agentDefinitionId, RuntimeBundleValidator.ValidationResult validation) {
        List<PublishedResourceRevision> published = jdbcTemplate.query("""
                SELECT r.resource_id, r.resource_revision, r.content_digest, r.metadata_json
                FROM runtime_bundle_resources r
                JOIN runtime_bundle_versions v ON v.bundle_version_id = r.bundle_version_id
                WHERE v.agent_definition_id = ?
                """, (resultSet, rowNumber) -> new PublishedResourceRevision(
                        resultSet.getString("resource_id"),
                        resultSet.getInt("resource_revision"),
                        resultSet.getString("content_digest"),
                        digests.canonicalJson(readJson(resultSet.getString("metadata_json")))),
                agentDefinitionId);
        List<String> errors = new ArrayList<>(validation.errors());
        validation.resources().forEach(resource -> {
            String resourceId = resource.path("resource_id").asText();
            int revision = resource.path("revision").asInt();
            String contentDigest = resource.path("content_digest").asText();
            ObjectNode metadata = (ObjectNode) resource.deepCopy();
            metadata.remove("content");
            String metadataFingerprint = digests.canonicalJson(metadata);
            int maximumPublishedRevision = published.stream()
                    .filter(item -> item.resourceId().equals(resourceId))
                    .mapToInt(PublishedResourceRevision::revision)
                    .max()
                    .orElse(0);
            if (revision < maximumPublishedRevision) {
                errors.add("resource_revision_not_monotonic:" + resourceId + ":" + revision);
            }
            boolean revisionChangedContent = published.stream().anyMatch(item ->
                    item.resourceId().equals(resourceId)
                            && item.revision() == revision
                            && !item.contentDigest().equals(contentDigest));
            if (revisionChangedContent) {
                errors.add("resource_revision_content_changed:" + resourceId + ":" + revision);
            }
            boolean revisionChangedMetadata = published.stream().anyMatch(item ->
                    item.resourceId().equals(resourceId)
                            && item.revision() == revision
                            && item.contentDigest().equals(contentDigest)
                            && !item.metadataFingerprint().equals(metadataFingerprint));
            if (revisionChangedMetadata) {
                errors.add("resource_revision_metadata_changed:" + resourceId + ":" + revision);
            }
        });
        return new RuntimeBundleValidator.ValidationResult(
                List.copyOf(errors), validation.composition(), validation.resources(),
                validation.manifestDigest());
    }

    private RuntimeBundleApi.AgentDefinitionResponse readAgent(String agentDefinitionId) {
        List<RuntimeBundleApi.AgentDefinitionResponse> rows = jdbcTemplate.query("""
                SELECT agent_definition_id, definition_key, display_name, description,
                       active_bundle_version_id
                FROM runtime_agent_definitions WHERE agent_definition_id = ?
                """, (resultSet, rowNumber) -> new RuntimeBundleApi.AgentDefinitionResponse(
                        resultSet.getString("agent_definition_id"),
                        resultSet.getString("definition_key"),
                        resultSet.getString("display_name"),
                        resultSet.getString("description"),
                        resultSet.getString("active_bundle_version_id")), agentDefinitionId);
        if (rows.isEmpty()) {
            throw notFound("AgentDefinition 不存在");
        }
        return rows.get(0);
    }

    private void requireAgent(String agentDefinitionId) {
        readAgent(agentDefinitionId);
    }

    private void requireVersionForAgent(String bundleVersionId, String agentDefinitionId) {
        Long count = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM runtime_bundle_versions
                WHERE bundle_version_id = ? AND agent_definition_id = ?
                """, Long.class, bundleVersionId, agentDefinitionId);
        if (count == null || count != 1) {
            throw notFound("BundleVersion 不属于指定 AgentDefinition");
        }
    }

    private Map<String, String> resourceDigests(ArrayNode resources) {
        Map<String, String> result = new HashMap<>();
        resources.forEach(resource -> result.put(
                resource.path("resource_id").asText(), resource.path("content_digest").asText()));
        return result;
    }

    private String versionId(
            String agentDefinitionId, String draftId, int draftRevision, String version) {
        String identityDigest = digests.content(
                agentDefinitionId + "\u0000" + draftId + "\u0000" + draftRevision + "\u0000" + version);
        return "bundle_" + identityDigest.substring("sha256:".length(), "sha256:".length() + 32);
    }

    private <T> T idempotent(
            String operation,
            String idempotencyKey,
            Long actorUserId,
            Object request,
            Class<T> responseType,
            Supplier<T> action) {
        String requestHash = digests.canonicalJson(objectMapper.valueToTree(request));
        try {
            accessPolicy.requireAdmin(actorUserId);
            requireIdempotencyKey(idempotencyKey);
            boolean reserved;
            try {
                jdbcTemplate.update("""
                        INSERT INTO runtime_bundle_write_idempotency
                            (operation, idempotency_key, request_hash, response_json, actor_user_id)
                        VALUES (?, ?, ?, NULL, ?)
                        """, operation, idempotencyKey, requestHash, actorUserId);
                reserved = true;
            } catch (DuplicateKeyException exception) {
                reserved = false;
            }
            if (!reserved) {
                IdempotencyRecord record = readIdempotencyRecord(operation, idempotencyKey);
                if (!requestHash.equals(record.requestHash())) {
                    throw conflict("Idempotency-Key 已用于不同请求");
                }
                if (record.responseJson() == null) {
                    throw conflict("Idempotency-Key 对应请求仍在处理中");
                }
                return readJson(record.responseJson(), responseType);
            }
            T response = action.get();
            int completed = jdbcTemplate.update("""
                    UPDATE runtime_bundle_write_idempotency SET response_json = ?
                    WHERE operation = ? AND idempotency_key = ? AND request_hash = ?
                          AND response_json IS NULL
                    """, writeJson(response), operation, idempotencyKey, requestHash);
            if (completed != 1) {
                throw conflict("Idempotency-Key 结果写入冲突");
            }
            return response;
        } catch (RuntimeException exception) {
            FailureTarget target = failureTarget(operation, request, idempotencyKey);
            int errorCode = exception instanceof GlobalException globalException
                    ? globalException.getCode()
                    : SystemCode.FAILURE_CODE;
            failureAuditWriter.record(actorUserId, auditEvent(operation), target.type(),
                    target.id(), requestHash, errorCode);
            throw exception;
        }
    }

    private IdempotencyRecord readIdempotencyRecord(String operation, String idempotencyKey) {
        List<IdempotencyRecord> existing = jdbcTemplate.query("""
                SELECT request_hash, response_json FROM runtime_bundle_write_idempotency
                WHERE operation = ? AND idempotency_key = ?
                """, (resultSet, rowNumber) -> new IdempotencyRecord(
                        resultSet.getString("request_hash"), resultSet.getString("response_json")),
                operation, idempotencyKey);
        if (existing.isEmpty()) {
            throw conflict("Idempotency-Key 占位记录不存在");
        }
        return existing.get(0);
    }

    private String auditEvent(String operation) {
        return switch (operation) {
            case "CREATE_AGENT" -> "agent_definition.created";
            case "CREATE_DRAFT" -> "draft.created";
            case "UPDATE_DRAFT" -> "draft.updated";
            case "VALIDATE_DRAFT" -> "draft.validated";
            case "PUBLISH_BUNDLE" -> "version.published";
            case "ACTIVATE_BUNDLE" -> "version.activated";
            case "ROLLBACK_BUNDLE" -> "version.rolled_back";
            case "IMPORT_BUNDLE" -> "draft.imported";
            default -> "write.failed";
        };
    }

    private FailureTarget failureTarget(String operation, Object request, String idempotencyKey) {
        JsonNode value = objectMapper.valueToTree(request);
        return switch (operation) {
            case "CREATE_AGENT" -> new FailureTarget(
                    "agent_definition", value.path("agent_definition_id").asText("unknown"));
            case "CREATE_DRAFT", "ACTIVATE_BUNDLE", "ROLLBACK_BUNDLE", "IMPORT_BUNDLE" ->
                    new FailureTarget("agent_definition",
                            value.path("agent_definition_id").asText("unknown"));
            case "UPDATE_DRAFT", "VALIDATE_DRAFT", "PUBLISH_BUNDLE" ->
                    new FailureTarget("bundle_draft", value.path("draft_id").asText("unknown"));
            default -> new FailureTarget("write_command", idempotencyKey == null ? "missing" : idempotencyKey);
        };
    }

    private String manifestDigest(String bundleVersionId) {
        List<String> digests = jdbcTemplate.queryForList("""
                SELECT manifest_digest FROM runtime_bundle_versions WHERE bundle_version_id = ?
                """, String.class, bundleVersionId);
        if (digests.isEmpty()) {
            throw notFound("BundleVersion 不存在");
        }
        return digests.get(0);
    }

    private void verifyManifestDigest(JsonNode snapshot, String storedDigest) {
        JsonNode rawManifest = snapshot.path("composition").path("resource_manifest");
        if (rawManifest.isMissingNode()) {
            rawManifest = snapshot.path("composition").path("resourceManifest");
        }
        if (!rawManifest.isObject()) {
            throw conflict("BundleVersion 清单缺失");
        }
        ObjectNode manifest = rawManifest.deepCopy();
        String claimedDigest = manifest.path("manifestDigest").asText();
        manifest.remove("manifestDigest");
        String computedDigest = digests.canonicalJson(manifest);
        if (!computedDigest.equals(claimedDigest) || !computedDigest.equals(storedDigest)) {
            throw conflict("BundleVersion 清单摘要不一致");
        }
    }

    private void audit(
            Long actorUserId, String operation, String targetType, String targetId, ObjectNode details) {
        details.put("result", "success");
        details.putNull("error_code");
        jdbcTemplate.update("""
                INSERT INTO runtime_bundle_audit_records
                    (actor_user_id, operation, target_type, target_id, details_json)
                VALUES (?, ?, ?, ?, ?)
                """, actorUserId, operation, targetType, targetId, writeJson(details));
    }

    private void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new GlobalException(SystemCode.PARAM_MISS_CODE, "缺少 " + field);
        }
    }

    private void requireIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new GlobalException(SystemCode.PARAM_MISS_CODE, "缺少 Idempotency-Key");
        }
    }

    private GlobalException notFound(String message) {
        return new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, message);
    }

    private GlobalException conflict(String message) {
        return new GlobalException(SystemCode.AGENT_RUN_CONFLICT_CODE, message);
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new GlobalException(SystemCode.PARAM_VALID_ERROR_CODE, "Bundle JSON 无法序列化");
        }
    }

    private JsonNode readJson(String value) {
        return readJson(value, JsonNode.class);
    }

    private <T> T readJson(String value, Class<T> type) {
        try {
            return objectMapper.readValue(value, type);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("数据库中的 Bundle JSON 已损坏", exception);
        }
    }

    private record IdempotencyRecord(String requestHash, String responseJson) {}

    private record StoredVersion(JsonNode snapshot, String manifestDigest) {}

    private record PublishedResourceRevision(
            String resourceId, int revision, String contentDigest, String metadataFingerprint) {}

    private record FailureTarget(String type, String id) {}
}
