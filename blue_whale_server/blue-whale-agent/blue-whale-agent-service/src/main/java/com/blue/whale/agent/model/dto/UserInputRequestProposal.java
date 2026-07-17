package com.blue.whale.agent.model.dto;

import com.blue.whale.agent.model.entity.UserInputRequest;
import com.fasterxml.jackson.annotation.JsonProperty;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;

import java.util.Map;

/**
 * 产品中性输入请求提议（OrchestratorPort 输出，由 Java Product API 校验并接纳）。
 *
 * <p>该提议必须是产品中性的：不携带供应商私有字段（provider、价格目录、汇率、模型策略），
 * 也不暴露 Pydantic AI、DeferredToolRequest 等框架内部形态。与同一次 RunCommit 提交中的
 * 动作执行结果互斥：一次提交要么推进一个动作，要么提出一个输入请求，不能同时存在。
 *
 * <p>首版只支持 {@link UserInputRequest#REQUEST_TYPE_CREATION_CLARIFICATION}（创作澄清）；
 * 成本确认仍由 Java 侧 {@code GenerationAuthorizationGate} 的 {@code INPUT_REQUIRED} 决策
 * 在 commit 内部创建，不走 OrchestratorPort 提议路径。
 *
 * @param requestType  产品级请求类型，当前固定为 creation_clarification
 * @param question     Agent 向用户提出的可见问题，不可为空
 * @param resumeBinding 恢复绑定（不透明产品事实，回传给来源 AgentRun 用于恢复），可为空
 */
public record UserInputRequestProposal(
        @JsonProperty("request_type") @NotBlank
        @Pattern(regexp = UserInputRequest.REQUEST_TYPE_CREATION_CLARIFICATION,
                message = "首版只接受创作澄清提议")
        String requestType,
        @JsonProperty("question") @NotBlank String question,
        @JsonProperty("resume_binding") Map<String, Object> resumeBinding
) {
}
