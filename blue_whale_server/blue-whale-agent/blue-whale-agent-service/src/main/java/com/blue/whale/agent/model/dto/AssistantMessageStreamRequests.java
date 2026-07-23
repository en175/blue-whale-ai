package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import java.util.Map;

public final class AssistantMessageStreamRequests {
    private AssistantMessageStreamRequests() {
    }

    /** 三个流操作共享的 run 绑定字段：worker 身份、租约栅栏与引擎身份，随每个请求重复携带。 */
    public record RunBinding(
            Long projectId,
            Long userId,
            Integer expectedRunVersion,
            Long fencingToken,
            String engine,
            String engineVersion,
            Integer adapterSchemaVersion) {
    }

    public record Start(
            @JsonProperty("stream_id") @NotBlank String streamId,
            @JsonProperty("idempotency_key") @NotBlank @Size(max = 64) String idempotencyKey,
            @JsonProperty("project_id") @NotNull Long projectId,
            @JsonProperty("user_id") @NotNull Long userId,
            @JsonProperty("expected_run_version") @NotNull Integer expectedRunVersion,
            @JsonProperty("fencing_token") @NotNull Long fencingToken,
            @NotBlank String engine,
            @JsonProperty("engine_version") @NotBlank String engineVersion,
            @JsonProperty("adapter_schema_version") @NotNull Integer adapterSchemaVersion) {
        public RunBinding binding() {
            return new RunBinding(
                    projectId, userId, expectedRunVersion, fencingToken,
                    engine, engineVersion, adapterSchemaVersion);
        }
    }

    public record Chunk(
            @JsonProperty("stream_id") @NotBlank String streamId,
            @JsonProperty("idempotency_key") @NotBlank @Size(max = 64) String idempotencyKey,
            @JsonProperty("sequence_no") @NotNull @Min(1) Integer sequenceNo,
            @NotBlank String content,
            @JsonProperty("review_evidence") Map<String, Object> reviewEvidence,
            @JsonProperty("project_id") @NotNull Long projectId,
            @JsonProperty("user_id") @NotNull Long userId,
            @JsonProperty("expected_run_version") @NotNull Integer expectedRunVersion,
            @JsonProperty("fencing_token") @NotNull Long fencingToken,
            @NotBlank String engine,
            @JsonProperty("engine_version") @NotBlank String engineVersion,
            @JsonProperty("adapter_schema_version") @NotNull Integer adapterSchemaVersion) {
        public RunBinding binding() {
            return new RunBinding(
                    projectId, userId, expectedRunVersion, fencingToken,
                    engine, engineVersion, adapterSchemaVersion);
        }
    }

    public record Abort(
            @JsonProperty("stream_id") @NotBlank String streamId,
            @JsonProperty("idempotency_key") @NotBlank @Size(max = 64) String idempotencyKey,
            @JsonProperty("reason_code") @NotBlank @Size(max = 64) String reasonCode,
            @JsonProperty("project_id") @NotNull Long projectId,
            @JsonProperty("user_id") @NotNull Long userId,
            @JsonProperty("expected_run_version") @NotNull Integer expectedRunVersion,
            @JsonProperty("fencing_token") @NotNull Long fencingToken,
            @NotBlank String engine,
            @JsonProperty("engine_version") @NotBlank String engineVersion,
            @JsonProperty("adapter_schema_version") @NotNull Integer adapterSchemaVersion) {
        public RunBinding binding() {
            return new RunBinding(
                    projectId, userId, expectedRunVersion, fencingToken,
                    engine, engineVersion, adapterSchemaVersion);
        }
    }

    public record Complete(
            @JsonProperty("stream_id") @NotBlank String streamId,
            @JsonProperty("idempotency_key") @NotBlank @Size(max = 64) String idempotencyKey,
            @JsonProperty("final_sequence_no") @NotNull @Min(1) Integer finalSequenceNo,
            @JsonProperty("content_digest") @NotBlank String contentDigest,
            @JsonProperty("project_id") @NotNull Long projectId,
            @JsonProperty("user_id") @NotNull Long userId,
            @JsonProperty("expected_run_version") @NotNull Integer expectedRunVersion,
            @JsonProperty("fencing_token") @NotNull Long fencingToken,
            @NotBlank String engine,
            @JsonProperty("engine_version") @NotBlank String engineVersion,
            @JsonProperty("adapter_schema_version") @NotNull Integer adapterSchemaVersion) {
        public RunBinding binding() {
            return new RunBinding(
                    projectId, userId, expectedRunVersion, fencingToken,
                    engine, engineVersion, adapterSchemaVersion);
        }
    }
}
