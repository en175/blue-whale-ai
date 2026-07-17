package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.UserInputRequestMapper;
import com.blue.whale.agent.model.entity.UserInputRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;

@Service
@RequiredArgsConstructor
public class UserInputRequestService {

    private static final List<String> CONFIRMATIONS = List.of(
            "确认", "确认执行", "确认继续执行", "同意继续执行", "继续执行");

    private final UserInputRequestMapper mapper;
    private final ObjectMapper objectMapper;
    private final CostControlProperties properties;
    private final PriceCatalog priceCatalog;
    private final AuditRecordWriter auditRecordWriter;

    @Transactional
    public UserInputRequest create(
            Long projectId,
            Long userId,
            Long conversationId,
            Long sourceAgentRunId,
            String actionIdentity,
            String actionType,
            Map<String, Object> arguments,
            PriceQuote quote) {
        return createRequest(projectId, userId, conversationId, sourceAgentRunId, null,
                actionIdentity, actionType, arguments, quote);
    }

    /**
     * 创建创作澄清请求（产品中性输入请求，归属 AgentRun）。
     *
     * <p>创作澄清不带动作报价与供应商字段：Agent 缺少推进创作所必需的信息时，向用户提出一个
     * 可见问题并等待自然语言回答。走 conversation 形（与成本确认 conversation 形共享 awaiting
     * 通道），不进 standalone 幂等键。
     *
     * @param question Agent 向用户提出的可见问题，不可为空
     */
    @Transactional
    public UserInputRequest createCreationClarification(
            Long projectId,
            Long userId,
            Long conversationId,
            Long sourceAgentRunId,
            String question) {
        if (question == null || question.isBlank()) {
            throw new IllegalArgumentException("创作澄清请求必须携带可见问题");
        }
        LocalDateTime now = mapper.selectCurrentTime();
        UserInputRequest request = new UserInputRequest()
                .setProjectId(projectId)
                .setUserId(userId)
                .setRequestType(UserInputRequest.REQUEST_TYPE_CREATION_CLARIFICATION)
                .setConversationId(conversationId)
                .setSourceAgentRunId(sourceAgentRunId)
                .setQuestion(question)
                .setActionIdentity("clarification:" + sourceAgentRunId)
                .setActionType(UserInputRequest.REQUEST_TYPE_CREATION_CLARIFICATION)
                .setArgumentsDigest(argumentsDigest(Map.of()))
                .setStatus(UserInputRequest.STATUS_PENDING)
                .setExpiresAt(now.plusMinutes(10));
        mapper.insert(request);
        return request;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW,
            noRollbackFor = GovernanceException.class)
    public UserInputRequest createStandalone(
            Long projectId,
            Long userId,
            String requestTargetType,
            String actionIdentity,
            String actionType,
            Map<String, Object> arguments,
            PriceQuote quote) {
        UserInputRequest existing = mapper.selectStandaloneForUpdate(
                projectId, userId, requestTargetType, actionIdentity);
        if (existing != null) {
            boolean sameCommand = Objects.equals(existing.getActionType(), actionType)
                    && Objects.equals(existing.getArgumentsDigest(), argumentsDigest(arguments))
                    && matchesQuote(existing, quote);
            if (!sameCommand) {
                throw auditedActionNotAllowed(projectId, userId, existing.getId(), existing,
                        "IDEMPOTENCY_KEY_REUSED");
            }
            return existing;
        }
        return createRequest(projectId, userId, null, null, requestTargetType,
                actionIdentity, actionType, arguments, quote);
    }

    private UserInputRequest createRequest(
            Long projectId,
            Long userId,
            Long conversationId,
            Long sourceAgentRunId,
            String requestTargetType,
            String actionIdentity,
            String actionType,
            Map<String, Object> arguments,
            PriceQuote quote) {
        LocalDateTime now = mapper.selectCurrentTime();
        UserInputRequest request = new UserInputRequest()
                .setProjectId(projectId)
                .setUserId(userId)
                .setRequestType(UserInputRequest.REQUEST_TYPE_COST_CONFIRMATION)
                .setConversationId(conversationId)
                .setSourceAgentRunId(sourceAgentRunId)
                .setRequestTargetType(requestTargetType)
                .setActionIdentity(actionIdentity)
                .setActionType(actionType)
                .setArgumentsDigest(argumentsDigest(arguments))
                .setQuotedAmountFen(quote.worstCaseFen())
                .setQuotedProvider(quote.provider())
                .setPriceCatalogVersion(quote.priceCatalogVersion())
                .setExchangeRateVersion(quote.exchangeRateVersion())
                .setModelPolicyVersion(quote.modelPolicyVersion())
                .setCostRuleVersion(properties.getRuleVersion())
                .setStatus(UserInputRequest.STATUS_PENDING)
                .setExpiresAt(now.plusMinutes(10));
        mapper.insert(request);
        return request;
    }

    @Transactional(noRollbackFor = PersistedUserInputDecisionException.class)
    public Long confirm(Long projectId, Long userId, Long requestId, String content) {
        return confirmWithinTransaction(projectId, userId, requestId, content, false);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW,
            noRollbackFor = PersistedUserInputDecisionException.class)
    public Long confirmStandalone(
            Long projectId, Long userId, Long requestId, String content) {
        return confirmWithinTransaction(projectId, userId, requestId, content, true);
    }

    private Long confirmWithinTransaction(
            Long projectId,
            Long userId,
            Long requestId,
            String content,
            boolean standaloneOnly) {
        UserInputRequest request = requireOwnedForUpdate(projectId, userId, requestId);
        LocalDateTime now = mapper.selectCurrentTime();
        boolean standaloneShape = request.getConversationId() == null
                && request.getSourceAgentRunId() == null
                && request.getRequestTargetType() != null;
        boolean conversationShape = request.getConversationId() != null
                && request.getSourceAgentRunId() != null
                && request.getRequestTargetType() == null;
        if ((standaloneOnly && !standaloneShape)
                || (!standaloneOnly && !conversationShape)) {
            throw persistedRejected(projectId, userId, requestId, request,
                    "CONFIRMATION_CHANNEL_MISMATCH");
        }
        if (!UserInputRequest.STATUS_PENDING.equals(request.getStatus())) {
            throw persistedRejected(
                    projectId, userId, requestId, request, "DUPLICATE_CONFIRMATION");
        }
        if (!request.getExpiresAt().isAfter(now)) {
            request.setStatus(UserInputRequest.STATUS_EXPIRED);
            mapper.updateById(request);
            throw persistedRejected(projectId, userId, requestId, request, "LATE_CONFIRMATION");
        }
        boolean creationClarification = request.isCreationClarification();
        if (creationClarification) {
            // 创作澄清接受任意非空自然语言回答（不限确认短语）。
            if (content == null || content.isBlank()) {
                auditRecordWriter.appendUserInputDecision(
                        request, "user_input_request.clarification_ambiguous", "needs_confirmation",
                        "AMBIGUOUS_CLARIFICATION_ANSWER", properties.getRuleVersion());
                throw PersistedUserInputDecisionException.inputRequired(requestId);
            }
            auditRecordWriter.appendUserInputDecision(
                    request, "user_input_request.clarification_answered", "allowed",
                    "CLARIFICATION_ANSWER_ACCEPTED", properties.getRuleVersion());
        } else {
            if (!CONFIRMATIONS.contains(normalize(content))) {
                auditRecordWriter.appendUserInputDecision(
                        request, "user_input_request.ambiguous", "needs_confirmation",
                        "AMBIGUOUS_CONFIRMATION", properties.getRuleVersion());
                throw PersistedUserInputDecisionException.inputRequired(requestId);
            }
            auditRecordWriter.appendUserInputDecision(
                    request, "user_input_request.confirm", "allowed",
                    "NATURAL_LANGUAGE_CONFIRMATION_ACCEPTED", properties.getRuleVersion());
        }
        request.setStatus(UserInputRequest.STATUS_CONFIRMED).setConfirmedAt(now);
        update(request);
        return request.getId();
    }

    /**
     * 将已确认请求绑定到权威 Conversation 回答消息（创作澄清用）。
     *
     * <p>回答消息在 confirm 之后才持久化，因此绑定在调用方建好消息后回填。
     * 仅创作澄清请求会绑定回答消息；成本确认请求返回 empty，调用方无需发 answered 事件。
     *
     * @return 创作澄清请求（含来源 AgentRun 用于发 answered 事件）；非创作澄清返回 empty
     */
    @Transactional
    public Optional<UserInputRequest> bindAnswerIfClarification(
            Long requestId, Long projectId, Long userId, Long answerMessageId) {
        UserInputRequest request = requireOwnedForUpdate(projectId, userId, requestId);
        if (!request.isCreationClarification()) {
            return Optional.empty();
        }
        if (!UserInputRequest.STATUS_CONFIRMED.equals(request.getStatus())
                || request.getAnswerMessageId() != null) {
            throw auditedActionNotAllowed(projectId, userId, requestId, request,
                    "DUPLICATE_ANSWER_BINDING");
        }
        request.setAnswerMessageId(answerMessageId);
        update(request);
        return Optional.of(request);
    }

    @Transactional
    public void bindResumedRun(Long requestId, Long runId) {
        UserInputRequest request = mapper.selectForUpdate(requestId);
        if (request == null || !UserInputRequest.STATUS_CONFIRMED.equals(request.getStatus())
                || request.getConversationId() == null || request.getSourceAgentRunId() == null
                || request.getRequestTargetType() != null
                || request.getResumedAgentRunId() != null) {
            Long projectId = request == null ? 0L : request.getProjectId();
            Long userId = request == null ? 0L : request.getUserId();
            throw auditedActionNotAllowed(projectId, userId, requestId, request,
                    "DUPLICATE_CONFIRMATION_BINDING");
        }
        request.setResumedAgentRunId(runId);
        update(request);
    }

    @Transactional
    public void consumeValidated(
            Long requestId,
            Long projectId,
            Long userId,
            Long resumedRunId,
            String actionIdentity,
            String actionType,
            Map<String, Object> arguments) {
        UserInputRequest request = requireOwnedForUpdate(projectId, userId, requestId);
        LocalDateTime now = mapper.selectCurrentTime();
        boolean conversationShape = request.getConversationId() != null
                && request.getSourceAgentRunId() != null
                && request.getRequestTargetType() == null;
        boolean baseValid = UserInputRequest.STATUS_CONFIRMED.equals(request.getStatus())
                && request.getExpiresAt().isAfter(now)
                && conversationShape
                && Objects.equals(request.getResumedAgentRunId(), resumedRunId);
        boolean creationClarification = request.isCreationClarification();
        // 创作澄清消费只校验归属、状态、未过期与 resumed run 绑定；不校验动作身份与报价
        //（创作澄清无绑定动作，恢复后 Agent 会基于回答提议新动作，走正常的成本确认或直接执行）。
        boolean valid = baseValid && (creationClarification
                || (Objects.equals(request.getActionIdentity(), actionIdentity)
                        && Objects.equals(request.getActionType(), actionType)
                        && Objects.equals(request.getArgumentsDigest(), argumentsDigest(arguments))
                        && priceCatalog.quote(actionType, arguments)
                                .filter(quote -> matchesQuote(request, quote)).isPresent()));
        if (!valid) {
            throw auditedActionNotAllowed(projectId, userId, requestId, request,
                    "CONFIRMATION_BINDING_REJECTED");
        }
        request.setStatus(UserInputRequest.STATUS_CONSUMED).setConsumedAt(now);
        auditRecordWriter.appendUserInputDecision(
                request, "user_input_request.consume", "allowed",
                "CONFIRMATION_BINDING_CONSUMED", properties.getRuleVersion());
        update(request);
    }

    @Transactional
    public ValidatedInputRequest consumeStandaloneValidated(
            Long requestId,
            Long projectId,
            Long userId,
            String requestTargetType,
            String actionIdentity,
            String actionType,
            Map<String, Object> arguments) {
        UserInputRequest request = requireOwnedForUpdate(projectId, userId, requestId);
        LocalDateTime now = mapper.selectCurrentTime();
        Optional<PriceQuote> currentQuote = priceCatalog.quote(actionType, arguments);
        boolean valid = UserInputRequest.STATUS_CONFIRMED.equals(request.getStatus())
                && request.getExpiresAt().isAfter(now)
                && request.getConversationId() == null
                && request.getSourceAgentRunId() == null
                && request.getResumedAgentRunId() == null
                && Objects.equals(request.getRequestTargetType(), requestTargetType)
                && (actionIdentity == null
                        || Objects.equals(request.getActionIdentity(), actionIdentity))
                && Objects.equals(request.getActionType(), actionType)
                && Objects.equals(request.getArgumentsDigest(), argumentsDigest(arguments))
                && currentQuote.filter(quote -> matchesQuote(request, quote)).isPresent();
        if (!valid) {
            throw auditedActionNotAllowed(projectId, userId, requestId, request,
                    "CONFIRMATION_BINDING_REJECTED");
        }
        PriceQuote quote = currentQuote.orElseThrow();
        request.setStatus(UserInputRequest.STATUS_CONSUMED).setConsumedAt(now);
        auditRecordWriter.appendUserInputDecision(
                request, "user_input_request.consume", "allowed",
                "CONFIRMATION_BINDING_CONSUMED", properties.getRuleVersion());
        update(request);
        return new ValidatedInputRequest(request.getActionIdentity(), quote);
    }

    private boolean matchesQuote(UserInputRequest request, PriceQuote quote) {
        return request.getQuotedAmountFen() == quote.worstCaseFen()
                && Objects.equals(request.getQuotedProvider(), quote.provider())
                && Objects.equals(request.getPriceCatalogVersion(), quote.priceCatalogVersion())
                && Objects.equals(request.getExchangeRateVersion(), quote.exchangeRateVersion())
                && Objects.equals(request.getModelPolicyVersion(), quote.modelPolicyVersion())
                && Objects.equals(request.getCostRuleVersion(), properties.getRuleVersion());
    }

    public String argumentsDigest(Map<String, Object> arguments) {
        try {
            byte[] value = objectMapper.writeValueAsBytes(canonicalize(arguments));
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value));
        } catch (JsonProcessingException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException("无法计算动作摘要", exception);
        }
    }

    private UserInputRequest requireOwnedForUpdate(Long projectId, Long userId, Long requestId) {
        UserInputRequest request = mapper.selectForUpdate(requestId);
        if (request == null || !Objects.equals(request.getProjectId(), projectId)
                || !Objects.equals(request.getUserId(), userId)) {
            throw auditedActionNotAllowed(projectId, userId, requestId, request,
                    "CONFIRMATION_NOT_OWNED");
        }
        return request;
    }

    private GovernanceException auditedActionNotAllowed(
            Long projectId,
            Long userId,
            Long requestId,
            UserInputRequest request,
            String reasonCode) {
        appendRejectedDecision(projectId, userId, requestId, request, reasonCode);
        return GovernanceException.actionNotAllowed();
    }

    private void appendRejectedDecision(
            Long projectId,
            Long userId,
            Long requestId,
            UserInputRequest request,
            String reasonCode) {
        String correlationId = "user-input-request:" + requestId;
        // 创作澄清无报价字段：仅成本确认拒绝携带报价审计切片，避免对 null 报价拆箱。
        PriceQuote quote = request == null || request.getQuotedAmountFen() == null ? null
                : new PriceQuote(
                        request.getQuotedAmountFen(), request.getQuotedProvider(),
                        request.getPriceCatalogVersion(), request.getExchangeRateVersion(),
                        request.getModelPolicyVersion());
        String ruleVersion = request == null || request.getCostRuleVersion() == null
                ? properties.getRuleVersion() : request.getCostRuleVersion();
        auditRecordWriter.appendDeniedActionDecision(
                new ActionAuthorizationCommand(
                        userId, projectId, "UserInputRequest", String.valueOf(requestId),
                        correlationId,
                        request == null ? "confirmation:" + requestId : request.getActionIdentity(),
                        request == null ? "unknown" : request.getActionType(),
                        Map.of(), false, false),
                reasonCode, quote, ruleVersion);
    }

    private PersistedUserInputDecisionException persistedRejected(
            Long projectId,
            Long userId,
            Long requestId,
            UserInputRequest request,
            String reasonCode) {
        appendRejectedDecision(projectId, userId, requestId, request, reasonCode);
        return PersistedUserInputDecisionException.actionNotAllowed();
    }

    private Object canonicalize(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> canonical = new TreeMap<>();
            map.forEach((key, nested) -> canonical.put(String.valueOf(key), canonicalize(nested)));
            return canonical;
        }
        if (value instanceof List<?> list) {
            return list.stream().map(this::canonicalize).toList();
        }
        return value;
    }

    private String normalize(String content) {
        if (content == null) {
            return "";
        }
        return content.trim().replaceAll("[\\s，。！？!?、]", "");
    }

    private void update(UserInputRequest request) {
        if (mapper.updateById(request) != 1) {
            throw new IllegalStateException("UserInputRequest 状态已变化");
        }
    }
}
