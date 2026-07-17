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

    public record ProposedAction(
            @JsonProperty("action_id") @NotBlank String actionId,
            @JsonProperty("action_type") @NotBlank String actionType,
            @NotNull Map<String, Object> arguments
    ) {
    }
}
