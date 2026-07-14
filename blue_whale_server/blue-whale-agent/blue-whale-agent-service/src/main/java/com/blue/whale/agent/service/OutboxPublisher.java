package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.OutboxMessageMapper;
import com.blue.whale.agent.model.entity.OutboxMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/** 将同事务 Outbox 转成可重复的 Project 唤醒信号。重试不创建新的产品事件。 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "blue-whale.outbox.enabled", havingValue = "true", matchIfMissing = true)
public class OutboxPublisher {

    private static final int BATCH_SIZE = 100;

    private final OutboxMessageMapper outboxMapper;
    private final ProjectEventNotifier notifier;

    @Scheduled(fixedDelayString = "${blue-whale.outbox.publish-delay-ms:1000}")
    public void publishDue() {
        LocalDateTime now = LocalDateTime.now();
        List<OutboxMessage> due = outboxMapper.selectList(
                Wrappers.<OutboxMessage>lambdaQuery()
                        .eq(OutboxMessage::getStatus, OutboxMessage.STATUS_PENDING)
                        .and(query -> query.isNull(OutboxMessage::getNextAttemptAt)
                                .or()
                                .le(OutboxMessage::getNextAttemptAt, now))
                        .orderByAsc(OutboxMessage::getId)
                        .last("LIMIT " + BATCH_SIZE));
        due.forEach(this::publishOne);
    }

    private void publishOne(OutboxMessage message) {
        try {
            notifier.publish(new ProjectEventNotification(
                    message.getMessageId(), message.getProjectId(), message.getCursor()));
            message.setStatus(OutboxMessage.STATUS_PUBLISHED)
                    .setNextAttemptAt(null);
        } catch (RuntimeException exception) {
            int attemptCount = message.getAttemptCount() == null ? 1 : message.getAttemptCount() + 1;
            long backoffSeconds = Math.min(300L, 1L << Math.min(attemptCount - 1, 8));
            message.setAttemptCount(attemptCount)
                    .setNextAttemptAt(LocalDateTime.now().plusSeconds(backoffSeconds));
            log.warn("outbox publish failed messageId={} attempt={}",
                    message.getMessageId(), attemptCount, exception);
        }
        outboxMapper.updateById(message);
    }
}
