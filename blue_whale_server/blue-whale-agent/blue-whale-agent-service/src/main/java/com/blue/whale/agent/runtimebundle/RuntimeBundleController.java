package com.blue.whale.agent.runtimebundle;

import com.blue.whale.global.base.resp.Result;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PutMapping;

@RestController
@RequestMapping("/internal/runtime-bundles")
@RequiredArgsConstructor
final class RuntimeBundleController {

    private final RuntimeBundleAccessPolicy accessPolicy;
    private final RuntimeBundleService service;

    @PostMapping("/agents")
    Result<RuntimeBundleApi.AgentDefinitionResponse> createAgent(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody RuntimeBundleApi.CreateAgentRequest request) {
        return Result.ok(service.createAgent(request, userId, idempotencyKey));
    }

    @PostMapping("/agents/{agentDefinitionId}/drafts")
    Result<RuntimeBundleApi.DraftResponse> createDraft(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable String agentDefinitionId,
            @RequestBody RuntimeBundleApi.CreateDraftRequest request) {
        return Result.ok(service.createDraft(agentDefinitionId, request, userId, idempotencyKey));
    }

    @GetMapping("/drafts/{draftId}")
    Result<RuntimeBundleApi.DraftResponse> readDraft(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable String draftId) {
        accessPolicy.requireAdmin(userId);
        return Result.ok(service.readDraft(draftId));
    }

    @PutMapping("/drafts/{draftId}")
    Result<RuntimeBundleApi.DraftResponse> updateDraft(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable String draftId,
            @RequestBody RuntimeBundleApi.UpdateDraftRequest request) {
        return Result.ok(service.updateDraft(draftId, request, userId, idempotencyKey));
    }

    @PostMapping("/drafts/{draftId}/validate")
    Result<JsonNode> validateDraft(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable String draftId) {
        return Result.ok(service.validateDraft(draftId, userId, idempotencyKey));
    }

    @PostMapping("/drafts/{draftId}/publish")
    Result<JsonNode> publish(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable String draftId,
            @RequestBody RuntimeBundleApi.PublishRequest request) {
        return Result.ok(service.publish(draftId, request, userId, idempotencyKey));
    }

    @GetMapping("/drafts/{draftId}/diff")
    Result<JsonNode> diff(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable String draftId) {
        accessPolicy.requireAdmin(userId);
        return Result.ok(service.diff(draftId));
    }

    @PostMapping("/agents/{agentDefinitionId}/activate")
    Result<RuntimeBundleApi.AgentDefinitionResponse> activate(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable String agentDefinitionId,
            @RequestBody RuntimeBundleApi.VersionPointerRequest request) {
        return Result.ok(service.activate(agentDefinitionId, request, userId, idempotencyKey, false));
    }

    @PostMapping("/agents/{agentDefinitionId}/rollback")
    Result<RuntimeBundleApi.AgentDefinitionResponse> rollback(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable String agentDefinitionId,
            @RequestBody RuntimeBundleApi.VersionPointerRequest request) {
        return Result.ok(service.activate(agentDefinitionId, request, userId, idempotencyKey, true));
    }

    @GetMapping("/versions/{bundleVersionId}")
    Result<JsonNode> readVersion(
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @PathVariable String bundleVersionId) {
        accessPolicy.requireWorker(workerId);
        return Result.ok(service.readVersion(bundleVersionId));
    }

    @GetMapping("/versions/{bundleVersionId}/resources/{resourceId}")
    Result<JsonNode> readResource(
            @RequestHeader(value = "X-Worker-Id", required = false) String workerId,
            @PathVariable String bundleVersionId,
            @PathVariable String resourceId) {
        accessPolicy.requireWorker(workerId);
        return Result.ok(service.readResource(bundleVersionId, resourceId));
    }

    @GetMapping("/versions/{bundleVersionId}/export")
    Result<JsonNode> exportVersion(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @PathVariable String bundleVersionId) {
        return Result.ok(service.exportVersion(bundleVersionId, userId));
    }

    @PostMapping("/agents/{agentDefinitionId}/import")
    Result<RuntimeBundleApi.DraftResponse> importBundle(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @PathVariable String agentDefinitionId,
            @RequestBody JsonNode bundlePackage) {
        return Result.ok(service.importBundle(agentDefinitionId, bundlePackage, userId, idempotencyKey));
    }
}
