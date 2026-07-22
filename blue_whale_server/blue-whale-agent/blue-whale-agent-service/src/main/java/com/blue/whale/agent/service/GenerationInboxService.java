package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.CommandIdempotencyMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.AcceptConversationMessageRequest;
import com.blue.whale.agent.model.dto.AcceptConversationMessageResponse;
import com.blue.whale.agent.model.dto.GenerationInboxDto;
import com.blue.whale.agent.model.dto.InboxConversationDto;
import com.blue.whale.agent.model.dto.InboxMessageAcceptedResponse;
import com.blue.whale.agent.model.dto.InboxMessageRequest;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.entity.CommandIdempotency;
import com.blue.whale.agent.model.entity.Conversation;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 生成收件箱服务（IK21O9）：每用户一个 purpose=generation_inbox 的隐藏 Project（从项目列表隐藏，
 * 由 uk_project_inbox_guard 保证每用户最多一个未删除实例），首条消息懒建。
 *
 * <p>消息接纳委托 {@link ConversationCommandService#accept}——幂等、产品事件、AgentRun 排队与
 * canvas 项目同一实现；收件箱只负责 find-or-create 与对话落点解析。
 */
@Service
@RequiredArgsConstructor
public class GenerationInboxService {

    /** 收件箱固定名称；定位靠 purpose 不靠名称（允许用户改名）。 */
    private static final String INBOX_NAME = "生成收件箱";
    /** 对话列表预览截断长度。 */
    private static final int PREVIEW_MAX_LENGTH = 50;
    /** 新建收件箱对话的幂等 operation（ADR-0017 §4）。 */
    private static final String OPERATION_CONVERSATION_CREATE = "inbox.conversation.create";

    private final ProjectMapper projectMapper;
    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;
    private final CommandIdempotencyMapper idempotencyMapper;
    private final ProjectEventService projectEventService;
    private final ConversationCommandService conversationCommandService;
    private final ProjectPurgeService projectPurgeService;

    /** 取当前用户的生成收件箱；未创建返回 null（GET 是只读，不创建）。 */
    public GenerationInboxDto getInbox(Long userId) {
        Project inbox = findInbox(userId);
        if (inbox == null) {
            return null;
        }
        return new GenerationInboxDto(toProjectDto(inbox), latestConversationId(inbox.getId()));
    }

    /**
     * 接纳一条收件箱消息：收件箱不存在时懒建；{@code conversationId} 缺省落最新对话（无则新建），
     * 显式传入时的归属校验与接纳语义（幂等、事件、AgentRun）由 {@link ConversationCommandService#accept} 保证。
     */
    @Transactional
    public InboxMessageAcceptedResponse acceptMessage(Long userId, String idempotencyKey, InboxMessageRequest req) {
        Project inbox = findOrCreateInbox(userId);
        Long conversationId = req.conversationId() != null ? req.conversationId()
                : latestOrCreateConversationId(inbox.getId());
        AcceptConversationMessageResponse accepted = conversationCommandService.accept(
                inbox.getId(), userId, idempotencyKey,
                new AcceptConversationMessageRequest(req.clientMessageId(), req.content(),
                        req.replyToInputRequestId(), conversationId, null));
        return new InboxMessageAcceptedResponse(inbox.getId(), conversationId,
                accepted.messageId(), accepted.agentRunId(), accepted.cursor());
    }

    /** 列出收件箱全部对话（id 倒序）；preview 为该对话首条 user 消息截 50 字，无消息为空串。 */
    public List<InboxConversationDto> listConversations(Long userId) {
        Project inbox = requireInbox(userId);
        List<Conversation> conversations = conversationMapper.selectList(
                Wrappers.<Conversation>lambdaQuery()
                        .eq(Conversation::getProjectId, inbox.getId())
                        .orderByDesc(Conversation::getId));
        if (conversations.isEmpty()) {
            return List.of();
        }
        List<Long> conversationIds = conversations.stream().map(Conversation::getId).toList();
        Map<Long, ConversationMessage> firstUserMessage = messageMapper.selectFirstUserMessages(conversationIds)
                .stream()
                .collect(Collectors.toMap(ConversationMessage::getConversationId, Function.identity()));
        return conversations.stream()
                .map(c -> new InboxConversationDto(c.getId(), c.getGmtCreate(), preview(firstUserMessage.get(c.getId()))))
                .toList();
    }

    /**
     * 新建一段空对话（preview 为空串）。{@code Idempotency-Key} 必传（ADR-0016 §1）；
     * 同键重放按幂等记录的 resourceId 加载首次创建的对话返回（ADR-0017 §4），不重复建行。
     * 请求无 body，摘要取 operation 名固定串，同键冲突在事实上不会发生，仅保持契约完整。
     */
    @Transactional
    public InboxConversationDto createConversation(Long userId, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new GlobalException(100000, "缺少 Idempotency-Key");
        }
        Project inbox = requireInbox(userId);
        String requestHash = Sha256.hex(OPERATION_CONVERSATION_CREATE);
        CommandIdempotency existing = idempotencyMapper.selectOne(
                Wrappers.<CommandIdempotency>lambdaQuery()
                        .eq(CommandIdempotency::getProjectId, inbox.getId())
                        .eq(CommandIdempotency::getOperation, OPERATION_CONVERSATION_CREATE)
                        .eq(CommandIdempotency::getIdempotencyKey, idempotencyKey));
        if (existing != null) {
            if (!requestHash.equals(existing.getRequestHash())) {
                throw new GlobalException(SystemCode.IDEMPOTENCY_KEY_REUSED_CODE,
                        SystemCode.IDEMPOTENCY_KEY_REUSED.getMsg());
            }
            Conversation replayed = conversationMapper.selectById(existing.getResourceId());
            if (replayed == null) {
                throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
            }
            return new InboxConversationDto(replayed.getId(), replayed.getGmtCreate(), "");
        }
        Conversation conversation = new Conversation().setProjectId(inbox.getId());
        conversationMapper.insert(conversation);
        idempotencyMapper.insert(new CommandIdempotency()
                .setProjectId(inbox.getId())
                .setOperation(OPERATION_CONVERSATION_CREATE)
                .setIdempotencyKey(idempotencyKey)
                .setRequestHash(requestHash)
                .setResourceId(conversation.getId())
                .setAcceptedCursor(projectEventService.highWatermark(inbox.getId())));
        return new InboxConversationDto(conversation.getId(), conversation.getGmtCreate(), "");
    }

    /**
     * 永久删除收件箱：委托 {@link ProjectPurgeService} 的统一物理级联（IK25EG 对齐删除语义）——
     * 锁项目行序列化并发写入、尽力终结在途任务成本面、审计事件先行、
     * 共享存储对象仅在全表无其他引用时标记待回收、最小审计表保留。
     */
    @Transactional
    public void purgeInbox(Long userId) {
        Project inbox = requireInbox(userId);
        projectPurgeService.purge(inbox);
    }

    /**
     * 查收件箱，无则创建（固定名称、purpose=generation_inbox，并发 PROJECT_CREATED 事件）。
     * 并发首发撞 uk_project_inbox_guard 时另一事务已建，重新锁定读取返回。
     */
    private Project findOrCreateInbox(Long userId) {
        Project inbox = findInbox(userId);
        if (inbox != null) {
            return inbox;
        }
        Project created = new Project()
                .setOwnerId(userId)
                .setName(INBOX_NAME)
                .setPurpose(Project.PURPOSE_GENERATION_INBOX);
        try {
            projectMapper.insert(created);
        } catch (DuplicateKeyException e) {
            // MySQL duplicate key 只回滚当前语句，事务可继续；锁定读绕开 REPEATABLE READ 快照，
            // 取到对方已提交的收件箱行。
            Project concurrent = findInboxForUpdate(userId);
            if (concurrent == null) {
                throw e;
            }
            return concurrent;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", created.getName());
        payload.put("purpose", created.getPurpose());
        projectEventService.appendEvent(created.getId(), EventType.PROJECT_CREATED,
                AggregateType.PROJECT, String.valueOf(created.getId()), created.getVersion(),
                payload, null, null);
        return created;
    }

    private Long latestOrCreateConversationId(Long inboxId) {
        Long latestId = latestConversationId(inboxId);
        if (latestId != null) {
            return latestId;
        }
        Conversation conversation = new Conversation().setProjectId(inboxId);
        conversationMapper.insert(conversation);
        return conversation.getId();
    }

    /** 收件箱最新对话 id（无对话返回 null）。 */
    private Long latestConversationId(Long inboxId) {
        List<Conversation> latest = conversationMapper.selectList(
                Wrappers.<Conversation>lambdaQuery()
                        .eq(Conversation::getProjectId, inboxId)
                        .orderByDesc(Conversation::getId)
                        .last("LIMIT 1"));
        return latest.isEmpty() ? null : latest.get(0).getId();
    }

    private Project findInbox(Long userId) {
        return projectMapper.selectOne(Wrappers.<Project>lambdaQuery()
                .eq(Project::getOwnerId, userId)
                .eq(Project::getPurpose, Project.PURPOSE_GENERATION_INBOX));
    }

    private Project findInboxForUpdate(Long userId) {
        return projectMapper.selectOne(Wrappers.<Project>lambdaQuery()
                .eq(Project::getOwnerId, userId)
                .eq(Project::getPurpose, Project.PURPOSE_GENERATION_INBOX)
                .last("FOR UPDATE"));
    }

    private Project requireInbox(Long userId) {
        Project inbox = findInbox(userId);
        if (inbox == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return inbox;
    }

    private String preview(ConversationMessage firstUserMessage) {
        if (firstUserMessage == null || firstUserMessage.getContent() == null) {
            return "";
        }
        String content = firstUserMessage.getContent();
        return content.length() <= PREVIEW_MAX_LENGTH ? content : content.substring(0, PREVIEW_MAX_LENGTH);
    }

    private ProjectDto toProjectDto(Project p) {
        return new ProjectDto(p.getId(), p.getName(), p.getThumb(), p.getGmtCreate(), p.getPurpose());
    }

}
