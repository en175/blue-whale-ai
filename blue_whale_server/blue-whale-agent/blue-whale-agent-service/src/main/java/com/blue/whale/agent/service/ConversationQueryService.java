package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.MessageAssetReferenceMapper;
import com.blue.whale.agent.model.dto.ConversationHistoryResponse;
import com.blue.whale.agent.model.dto.ConversationHistoryResponse.MessageItem;
import com.blue.whale.agent.model.dto.ConversationSummaryResponse;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.ConversationMessage;
import com.blue.whale.agent.model.entity.MessageAssetReference;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Conversation 只读查询（IK2QBZ）：面向 Python Agent Worker 的对话摘要与游标分页历史。
 *
 * 以 runId 为根，X-Worker-Id 校验租约归属（leaseOwner 匹配 + 未过期）——Project 范围天然绑定
 * （run 绑定唯一 conversation/project），Worker 拿不到别的 Project 的 run 的租约，故跨 Project
 * 不可能发生。游标用 conversation_messages.sequence_no 单调序号（对齐 Project SSE 数字游标哲学）。
 * 查询叠加 project_id 双保险（与 conversation_id 一致），防任何跨对话渗漏。
 */
@Service
@RequiredArgsConstructor
public class ConversationQueryService {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int PREVIEW_MAX_LENGTH = 50;
    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final ConversationMessageMapper messageMapper;
    private final MessageAssetReferenceMapper messageAssetReferenceMapper;
    private final RunLeaseGuard runLeaseGuard;

    public ConversationHistoryResponse history(Long runId, String workerId, Integer after, Integer limit) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        int pageSize = clampPageSize(limit);
        var query = Wrappers.<ConversationMessage>lambdaQuery()
                .eq(ConversationMessage::getConversationId, run.getConversationId())
                .eq(ConversationMessage::getProjectId, run.getProjectId())
                .orderByAsc(ConversationMessage::getSequenceNo)
                .last("LIMIT " + (pageSize + 1));
        if (after != null) {
            query.gt(ConversationMessage::getSequenceNo, after);
        }
        List<ConversationMessage> page = messageMapper.selectList(query);
        boolean hasMore = page.size() > pageSize;
        Long nextCursor = null;
        if (hasMore) {
            page = page.subList(0, pageSize);
            nextCursor = page.get(page.size() - 1).getSequenceNo().longValue();
        }
        Map<Long, List<Long>> referencesByMessage = loadReferencedAssetIds(page);
        List<MessageItem> items = page.stream()
                .map(m -> new MessageItem(m.getId(), m.getRole(), m.getContent(),
                        m.getSequenceNo(), m.getAgentRunId(),
                        referencesByMessage.getOrDefault(m.getId(), List.of())))
                .toList();
        return new ConversationHistoryResponse(run.getConversationId(), items, nextCursor, hasMore);
    }

    public ConversationSummaryResponse summary(Long runId, String workerId) {
        AgentRun run = runLeaseGuard.requireLeasedRun(runId, workerId);
        List<ConversationMessage> messages = messageMapper.selectList(
                Wrappers.<ConversationMessage>lambdaQuery()
                        .eq(ConversationMessage::getConversationId, run.getConversationId())
                        .eq(ConversationMessage::getProjectId, run.getProjectId())
                        .orderByAsc(ConversationMessage::getSequenceNo));
        int count = messages.size();
        String firstUserPreview = messages.stream()
                .filter(m -> ConversationMessage.ROLE_USER.equals(m.getRole()))
                .map(ConversationMessage::getContent)
                .findFirst()
                .map(this::truncate)
                .orElse(null);
        String lastPreview = messages.isEmpty() ? null : truncate(messages.get(messages.size() - 1).getContent());
        String earliestAt = messages.isEmpty() ? null : messages.get(0).getGmtCreate().format(ISO);
        String latestAt = messages.isEmpty() ? null : messages.get(messages.size() - 1).getGmtCreate().format(ISO);
        return new ConversationSummaryResponse(run.getConversationId(), count, firstUserPreview,
                lastPreview, earliestAt, latestAt);
    }

    private int clampPageSize(Integer limit) {
        if (limit == null || limit < 1) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(limit, MAX_PAGE_SIZE);
    }

    private String truncate(String content) {
        if (content == null) {
            return null;
        }
        return content.length() <= PREVIEW_MAX_LENGTH ? content : content.substring(0, PREVIEW_MAX_LENGTH);
    }

    /**
     * 批量加载一页消息各自 @ 引用的 assetId（按 mention_seq 升序）。
     * 单次 IN 查询 + computeIfAbsent 分组——迭代序即升序，免逐组排序；空 page 短路零查询。
     * 每页固定 2 条查询（messages + references），与页大小无关，规避 N+1。
     */
    private Map<Long, List<Long>> loadReferencedAssetIds(List<ConversationMessage> page) {
        if (page.isEmpty()) {
            return Map.of();
        }
        List<Long> messageIds = page.stream().map(ConversationMessage::getId).toList();
        List<MessageAssetReference> references = messageAssetReferenceMapper.selectList(
                Wrappers.<MessageAssetReference>lambdaQuery()
                        .in(MessageAssetReference::getMessageId, messageIds)
                        .orderByAsc(MessageAssetReference::getMentionSeq));
        Map<Long, List<Long>> byMessage = new HashMap<>();
        for (MessageAssetReference reference : references) {
            byMessage.computeIfAbsent(reference.getMessageId(), key -> new ArrayList<>())
                    .add(reference.getAssetId());
        }
        return byMessage;
    }
}
