package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.CommandIdempotencyMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.MessageAssetReferenceMapper;
import com.blue.whale.agent.mapper.UserInputRequestMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.config.AgentOrchestratorProperties;
import com.blue.whale.agent.model.dto.AcceptConversationMessageRequest;
import com.blue.whale.agent.model.dto.AcceptConversationMessageResponse;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.CommandIdempotency;
import com.blue.whale.agent.model.entity.Conversation;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.model.entity.MessageAssetReference;
import com.blue.whale.agent.model.entity.UserInputRequest;
import com.blue.whale.agent.runtimebundle.RuntimeBundleRunPinResolver;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.agent.service.governance.UserInputRequestService;
import com.blue.whale.agent.service.governance.PersistedUserInputDecisionException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class ConversationCommandService {

    private static final String OPERATION = "conversation.message.accept";

    private final ProjectService projectService;
    private final AgentOrchestratorProperties orchestratorProperties;
    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;
    private final AgentRunMapper agentRunMapper;
    private final CommandIdempotencyMapper idempotencyMapper;
    private final AssetMapper assetMapper;
    private final MessageAssetReferenceMapper messageAssetReferenceMapper;
    private final ProjectEventService projectEventService;
    private final UserInputRequestService userInputRequestService;
    private final UserInputRequestMapper userInputRequestMapper;
    private final RuntimeBundleRunPinResolver runtimeBundleRunPinResolver;

    @Transactional(noRollbackFor = PersistedUserInputDecisionException.class)
    public AcceptConversationMessageResponse accept(Long projectId, Long userId, String idempotencyKey,
                                                     AcceptConversationMessageRequest request) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new GlobalException(100000, "缺少 Idempotency-Key");
        }
        projectService.requireOwnedForUpdate(projectId, userId);
        String requestHash = requestHash(request);
        CommandIdempotency existing = idempotencyMapper.selectOne(
                Wrappers.<CommandIdempotency>lambdaQuery()
                        .eq(CommandIdempotency::getProjectId, projectId)
                        .eq(CommandIdempotency::getOperation, OPERATION)
                        .eq(CommandIdempotency::getIdempotencyKey, idempotencyKey));
        if (existing != null) {
            if (!requestHash.equals(existing.getRequestHash())) {
                throw new GlobalException(SystemCode.IDEMPOTENCY_KEY_REUSED_CODE,
                        SystemCode.IDEMPOTENCY_KEY_REUSED.getMsg());
            }
            return response(existing);
        }
        Long confirmedInputRequestId = request.replyToInputRequestId() == null ? null
                : userInputRequestService.confirm(
                        projectId, userId, request.replyToInputRequestId(), request.content());
        // resumed run 继承来源 AgentRun 的引擎身份：运行中的 AgentRun 固定到创建时的
        // engine、engine_version 与 adapter_schema_version（ADR-0019 §1），恢复后认领它的
        // Worker 必须面对与来源流程一致的引擎身份与 checkpoint。
        AgentRun sourceRun = confirmedInputRequestId == null ? null
                : sourceRunOf(confirmedInputRequestId);
        RuntimeBundleRunPinResolver.RunPin runPin = runtimeBundleRunPinResolver.resolve(sourceRun);

        Conversation conversation = resolveConversation(projectId, request.conversationId());

        AgentRun run = new AgentRun()
                .setProjectId(projectId)
                .setConversationId(conversation.getId())
                .setUserId(userId)
                .setStatus(AgentRun.STATUS_QUEUED)
                .setStage("understanding")
                .setEngine(sourceRun != null ? sourceRun.getEngine() : orchestratorProperties.getEngine())
                .setEngineVersion(sourceRun != null ? sourceRun.getEngineVersion()
                        : orchestratorProperties.getEngineVersion())
                .setAdapterSchemaVersion(sourceRun != null ? sourceRun.getAdapterSchemaVersion()
                        : orchestratorProperties.getAdapterSchemaVersion())
                .setBundleVersionId(runPin.bundleVersionId())
                .setManifestDigest(runPin.manifestDigest())
                .setModelProfileId(runPin.modelProfileId())
                .setModelProfileVersion(runPin.modelProfileVersion())
                .setActivatedCreativeSkillVersions(runPin.activatedCreativeSkillVersions())
                .setToolGrants(runPin.toolGrants())
                .setConfirmedInputRequestId(confirmedInputRequestId)
                .setFencingToken(0L);
        agentRunMapper.insert(run);
        if (confirmedInputRequestId != null) {
            userInputRequestService.bindResumedRun(confirmedInputRequestId, run.getId());
        }
        // IK3BG2（ADR-0043）：新消息创建新 Run 时，同 Conversation 其余非终态 Run 原子置为
        // superseded 终态——fencing token 递增、释放租约；在途旧 Worker 下次 commit 因 version /
        // fencing / 租约校验失败收到 409（AGENT_RUN_CONFLICT）并确定性退出、不再提交任何状态。
        // 已提交 GenerationJob 不级联改写（CONTEXT.md 既有语义）。
        supersedeInFlightRuns(conversation.getId(), run.getId(), projectId, request.clientMessageId());

        long messageCount = messageMapper.selectCount(Wrappers.<ConversationMessage>lambdaQuery()
                .eq(ConversationMessage::getConversationId, conversation.getId()));
        ConversationMessage message = new ConversationMessage()
                .setConversationId(conversation.getId())
                .setProjectId(projectId)
                .setAgentRunId(run.getId())
                .setClientMessageId(request.clientMessageId())
                .setRole(ConversationMessage.ROLE_USER)
                .setContent(request.content())
                .setSequenceNo(Math.toIntExact(messageCount + 1));
        messageMapper.insert(message);
        // IK39QX：@ 引用随消息同事务持久化；越权/失效 id 已在 filterOwnedReferenceAssetIds 静默过滤，
        // mention_seq 按过滤后有效子集的请求顺序 1-based 赋值。
        List<Long> referencedAssetIds = filterOwnedReferenceAssetIds(projectId, userId, request.referencedAssetIds());
        int mentionSeq = 0;
        for (Long assetId : referencedAssetIds) {
            messageAssetReferenceMapper.insert(new MessageAssetReference()
                    .setMessageId(message.getId())
                    .setConversationId(conversation.getId())
                    .setProjectId(projectId)
                    .setAssetId(assetId)
                    .setMentionSeq(++mentionSeq));
        }

        Map<String, Object> messagePayload = new LinkedHashMap<>();
        messagePayload.put("message_id", message.getId());
        messagePayload.put("conversation_id", conversation.getId());
        messagePayload.put("agent_run_id", run.getId());
        messagePayload.put("role", message.getRole());
        messagePayload.put("content", message.getContent());
        messagePayload.put("sequence_no", message.getSequenceNo());
        projectEventService.appendEvent(projectId, EventType.CONVERSATION_MESSAGE_ACCEPTED,
                AggregateType.CONVERSATION, String.valueOf(conversation.getId()), message.getSequenceNo(),
                messagePayload, request.clientMessageId(), null);

        projectEventService.appendEvent(projectId, EventType.AGENT_RUN_CREATED,
                AggregateType.AGENT_RUN, String.valueOf(run.getId()), 0,
                runPayload(run), request.clientMessageId(), null);

        if (confirmedInputRequestId != null) {
            // 创作澄清回答绑定到权威消息，并向 ADR-0016 §5 靠拢发 AgentRun 聚合 answered 事件。
            // 成本确认请求不绑定回答消息，bindAnswerIfClarification 返回 empty 时跳过。
            userInputRequestService.bindAnswerIfClarification(
                    confirmedInputRequestId, projectId, userId, message.getId())
                    .ifPresent(clarification -> emitClarificationAnswered(
                            projectId, clarification, run.getId(), message.getId()));
        }

        long cursor = projectEventService.highWatermark(projectId);
        CommandIdempotency accepted = new CommandIdempotency()
                .setProjectId(projectId)
                .setOperation(OPERATION)
                .setIdempotencyKey(idempotencyKey)
                .setRequestHash(requestHash)
                .setMessageId(message.getId())
                .setAgentRunId(run.getId())
                .setAcceptedCursor(cursor);
        idempotencyMapper.insert(accepted);
        return response(accepted);
    }

    private AcceptConversationMessageResponse response(CommandIdempotency record) {
        return new AcceptConversationMessageResponse(
                record.getMessageId(), record.getAgentRunId(), record.getAcceptedCursor());
    }

    /**
     * 解析消息落点 Conversation 并加锁（FOR UPDATE）。
     *
     * <p>显式传 {@code conversationId} 时必须属于本项目，否则按资源不存在处理（不泄漏存在性）；
     * 未传时取项目下最新一条（生成收件箱允许多段对话，不能用 selectOne），无则懒建。
     * canvas 项目事实上只有一条对话，行为与此前一致。
     */
    private Conversation resolveConversation(Long projectId, Long conversationId) {
        if (conversationId != null) {
            Conversation specified = conversationMapper.selectForUpdate(conversationId);
            if (specified == null || !specified.getProjectId().equals(projectId)) {
                throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
            }
            return specified;
        }
        List<Conversation> conversations = conversationMapper.selectList(
                Wrappers.<Conversation>lambdaQuery()
                        .eq(Conversation::getProjectId, projectId)
                        .orderByDesc(Conversation::getId));
        Conversation conversation = conversations.isEmpty() ? null : conversations.get(0);
        if (conversation == null) {
            conversation = new Conversation().setProjectId(projectId);
            conversationMapper.insert(conversation);
        }
        conversation = conversationMapper.selectForUpdate(conversation.getId());
        if (conversation == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return conversation;
    }

    /**
     * IK3BG2（ADR-0043）：把同 Conversation 除新 Run 外的非终态 Run 原子置为 superseded 终态。
     *
     * <p>FOR UPDATE 与 claim 的行锁互斥，避免与正在认领的 Run 竞争漏取代；fencing token 递增 +
     * 释放租约使在途旧 Worker 下次 commit 确定性收到 409。逐个发 AGENT_RUN_STATUS_CHANGED 事件，
     * 与既有状态迁移口径一致。
     */
    private void supersedeInFlightRuns(Long conversationId, Long newRunId, Long projectId,
                                       String clientMessageId) {
        List<AgentRun> inFlight = agentRunMapper.selectList(Wrappers.<AgentRun>lambdaQuery()
                .eq(AgentRun::getConversationId, conversationId)
                .ne(AgentRun::getId, newRunId)
                .in(AgentRun::getStatus, AgentRun.STATUS_QUEUED, AgentRun.STATUS_RUNNING,
                        AgentRun.STATUS_AWAITING_JOB, AgentRun.STATUS_AWAITING_INPUT)
                .last("FOR UPDATE"));
        for (AgentRun stale : inFlight) {
            // lambdaUpdate 显式置空租约列（updateById 的 NOT_NULL 字段策略不持久化 null）；
            // version 条件兜底并发认领竞争。
            agentRunMapper.update(null, Wrappers.<AgentRun>lambdaUpdate()
                    .eq(AgentRun::getId, stale.getId())
                    .eq(AgentRun::getVersion, stale.getVersion())
                    .set(AgentRun::getStatus, AgentRun.STATUS_SUPERSEDED)
                    .set(AgentRun::getStage, "superseded")
                    .set(AgentRun::getFencingToken, stale.getFencingToken() + 1)
                    .set(AgentRun::getLeaseOwner, null)
                    .set(AgentRun::getLeaseExpiresAt, null));
            AgentRun superseded = agentRunMapper.selectById(stale.getId());
            projectEventService.appendEvent(projectId, EventType.AGENT_RUN_STATUS_CHANGED,
                    AggregateType.AGENT_RUN, String.valueOf(superseded.getId()), superseded.getVersion(),
                    runPayload(superseded), clientMessageId, null);
        }
    }

    private Map<String, Object> runPayload(AgentRun run) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("agent_run_id", run.getId());
        payload.put("conversation_id", run.getConversationId());
        payload.put("status", run.getStatus());
        payload.put("stage", run.getStage());
        payload.put("engine", run.getEngine());
        payload.put("engine_version", run.getEngineVersion());
        payload.put("adapter_schema_version", run.getAdapterSchemaVersion());
        payload.put("bundle_version_id", run.getBundleVersionId());
        payload.put("manifest_digest", run.getManifestDigest());
        payload.put("model_profile_id", run.getModelProfileId());
        payload.put("model_profile_version", run.getModelProfileVersion());
        payload.put("activated_creative_skill_versions", run.getActivatedCreativeSkillVersions());
        return payload;
    }

    /**
     * 解析已确认输入请求的来源 AgentRun（resumed run 继承引擎身份用）。
     * 数据异常（请求缺失或无来源 run）时返回 null，调用方回退配置默认身份。
     */
    private AgentRun sourceRunOf(Long confirmedInputRequestId) {
        UserInputRequest confirmed = userInputRequestMapper.selectById(confirmedInputRequestId);
        if (confirmed == null || confirmed.getSourceAgentRunId() == null) {
            return null;
        }
        return agentRunMapper.selectById(confirmed.getSourceAgentRunId());
    }

    private String requestHash(AcceptConversationMessageRequest request) {
        // 幂等键纳入去重后原始引用列表（DOM 序 distinct）；越权过滤发生在 hash 之后的落库阶段，
        // 故同幂等键不同客户端引用列表 = 冲突，与越权过滤解耦（ADR-0042 D2）。
        List<Long> referencedAssetIds = request.referencedAssetIds() == null
                ? List.of()
                : request.referencedAssetIds().stream().distinct().toList();
        String canonical = request.clientMessageId() + "\u0000" + request.content() + "\u0000"
                + String.valueOf(request.replyToInputRequestId()) + referencedAssetIds;
        return Sha256.hex(canonical);
    }

    /**
     * 过滤出归属本 project + user 的引用素材子集（ADR-0042 D2：Asset 存在且 projectId+userId 匹配）。
     *
     * <p>不卡 type、不卡 status（video 也能被 @；status 由读路径三元组兜底）。
     * 越权/失效（含逻辑删除、不存在）id 静默丢弃并 warn，返回保序的有效子集。
     */
    private List<Long> filterOwnedReferenceAssetIds(Long projectId, Long userId, List<Long> rawIds) {
        if (rawIds == null || rawIds.isEmpty()) {
            return List.of();
        }
        List<Long> distinctIds = rawIds.stream().distinct().toList();
        Set<Long> ownedAssetIds = assetMapper.selectBatchIds(distinctIds).stream()
                .filter(asset -> Objects.equals(asset.getProjectId(), projectId)
                        && Objects.equals(asset.getUserId(), userId))
                .map(Asset::getId)
                .collect(Collectors.toSet());
        List<Long> owned = distinctIds.stream().filter(ownedAssetIds::contains).toList();
        List<Long> dropped = distinctIds.stream().filter(id -> !ownedAssetIds.contains(id)).toList();
        if (!dropped.isEmpty()) {
            log.warn("丢弃越权/失效引用素材：projectId={}, userId={}, dropped={}", projectId, userId, dropped);
        }
        return owned;
    }

    /**
     * 发送创作澄清回答事件（AgentRun 聚合，ADR-0016 §5）。
     *
     * <p>事件聚合身份用来源（awaiting_input）AgentRun，回答后的 resumed run 作为 payload 字段，
     * 不另立聚合，保持与 requested 事件同一聚合边界。
     */
    private void emitClarificationAnswered(
            Long projectId,
            UserInputRequest clarification,
            Long resumedRunId,
            Long answerMessageId) {
        AgentRun sourceRun = clarification.getSourceAgentRunId() == null ? null
                : agentRunMapper.selectById(clarification.getSourceAgentRunId());
        int sourceVersion = sourceRun == null ? 0 : sourceRun.getVersion();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("input_request_id", clarification.getId());
        payload.put("source_agent_run_id", clarification.getSourceAgentRunId());
        payload.put("resumed_agent_run_id", resumedRunId);
        payload.put("answer_message_id", answerMessageId);
        payload.put("status", clarification.getStatus());
        projectEventService.appendEvent(projectId, EventType.AGENT_RUN_USER_INPUT_ANSWERED,
                AggregateType.AGENT_RUN,
                String.valueOf(clarification.getSourceAgentRunId()), sourceVersion,
                payload, null, null);
    }
}
