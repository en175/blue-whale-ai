package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import javax.validation.Valid;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

public record RunCommitRequest(
        @JsonProperty("commit_id") @NotBlank String commitId,
        @JsonProperty("project_id") @NotNull Long projectId,
        @JsonProperty("user_id") @NotNull Long userId,
        @JsonProperty("expected_run_version") @NotNull Integer expectedRunVersion,
        @JsonProperty("fencing_token") @NotNull Long fencingToken,
        @NotBlank String engine,
        @JsonProperty("engine_version") @NotBlank String engineVersion,
        @JsonProperty("adapter_schema_version") @NotNull Integer adapterSchemaVersion,
        @JsonProperty("assistant_message_stream_id") String assistantMessageStreamId,
        @JsonProperty("visible_text") @NotBlank String visibleText,
        @Valid @NotNull CommitCheckpoint checkpoint,
        @Valid @NotNull List<ProposedAction> actions,
        Map<String, Object> usage,
        @Valid @JsonProperty("user_input_request") UserInputRequestProposal userInputRequest,
        Map<String, Object> error
) {
    public record CommitCheckpoint(
            @JsonProperty("opaque_payload") @NotNull Map<String, Object> opaquePayload
    ) {
    }

    /**
     * Agent 提议的工具动作（注册表驱动）。{@code tool_id + registry_version} 绑定注册表
     * {@code ToolDefinition}，自由 {@code action_type} 已退役；{@code action_id} 确定性、Run 内唯一，
     * 作幂等键（同一 action_id 重复提交不产生重复 GenerationJob 或重复成本预留）。
     */
    public record ProposedAction(
            @JsonProperty("action_id") @NotBlank String actionId,
            @JsonProperty("tool_id") @NotBlank String toolId,
            @JsonProperty("registry_version") @NotNull Integer registryVersion,
            @NotNull Map<String, Object> arguments
    ) {
    }
}
