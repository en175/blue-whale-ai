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
        Map<String, Object> error,
        /** 资源读取证据（契约 §6 第 4 条）。Worker 随 commit 回传当次 Run 实际装载的 Bundle 资源摘要，
         * 与 {@code usage} 同通道：经 {@code requestDigest} 纳入幂等键；Java 侧逐条落主 audit_records（action=bundle.read_evidence），写入失败 fail closed 回滚整个提交。
         * 元素为 ReadEvidence（resource_id / revision / content_digest / token_estimate / origin），
         * 不含资源正文或私有路径；enforcement-disabled 的测试 Run 不携带此字段。
         * IK2QBZ：read_conversation_* 对话读取证据复用本通道（origin=conversation）。 */
        @JsonProperty("bundle_evidence") List<Map<String, Object>> bundleEvidence
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
