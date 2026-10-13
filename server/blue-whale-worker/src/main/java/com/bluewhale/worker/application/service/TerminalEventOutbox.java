package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationOutboxEntity;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutboxMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class TerminalEventOutbox {

    private static final Logger log = LoggerFactory.getLogger(TerminalEventOutbox.class);

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private static final Set<String> TERMINAL_STATUSES = Set.of(
            JobStatusEnum.SUCCEEDED.value(),
            JobStatusEnum.PARTIALLY_SUCCEEDED.value(),
            JobStatusEnum.FAILED.value(),
            JobStatusEnum.CANCELLED.value());

    private final GenerationOutboxMapper outboxMapper;
    private final GenerationJobMapper jobMapper;
    private final BillingEventPublisher producer;
    private final String terminalTopic;

    public TerminalEventOutbox(GenerationOutboxMapper outboxMapper,
                               GenerationJobMapper jobMapper,
                               BillingEventPublisher producer,
                               Environment env) {
        this.outboxMapper = outboxMapper;
        this.jobMapper = jobMapper;
        this.producer = producer;
        this.terminalTopic = env.getProperty("worker.billing.topic-terminal", "generation-job-terminal");
    }

    public static TerminalEventOutbox noop() {
        return new TerminalEventOutbox(null, null, BillingEventPublisher.noop(), new StandardEnvironment());
    }

    public void enqueue(GenerationJobEntity job, Map<String, Object> statusPayload) {
        String status = job.getStatus();
        if (outboxMapper == null || status == null || !TERMINAL_STATUSES.contains(status)) {
            return;
        }
        GenerationOutboxEntity row = new GenerationOutboxEntity();
        row.setJobId(job.getId());
        row.setUserId(job.getUserId());
        row.setTerminalStatus(status);
        row.setReason(reasonFor(status, statusPayload));
        row.setSendState(GenerationOutboxEntity.STATE_PENDING);
        row.setAttempts(0);
        outboxMapper.insert(row);
    }

    public void drain(int limit) {
        if (outboxMapper == null) {
            return;
        }
        List<GenerationOutboxEntity> pending = outboxMapper.listPending(limit);
        for (GenerationOutboxEntity row : pending) {
            try {
                producer.publish(terminalTopic, body(row));
                outboxMapper.markSent(row.getId());
            } catch (Exception e) {
                outboxMapper.bumpAttempts(row.getId());
                log.error("终态事件投递失败，保持 pending 下一轮重试：outboxId={} jobId={} status={} topic={}",
                        row.getId(), row.getJobId(), row.getTerminalStatus(), terminalTopic, e);
            }
        }
    }

    private String body(GenerationOutboxEntity row) {
        boolean refund = refundDue(row.getTerminalStatus(), providerTaskId(row));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", row.getJobId());
        body.put("userId", row.getUserId());
        body.put("status", row.getTerminalStatus());
        body.put("reason", refund ? row.getReason() : "");
        body.put("refund", refund);
        return toJson(body);
    }

    private String providerTaskId(GenerationOutboxEntity row) {
        if (!JobStatusEnum.CANCELLED.value().equals(row.getTerminalStatus())) {
            return null;
        }
        return jobMapper.findProviderTaskId(row.getJobId());
    }

    private static boolean refundDue(String status, String providerTaskId) {
        if (JobStatusEnum.FAILED.value().equals(status)) {
            return true;
        }
        if (JobStatusEnum.CANCELLED.value().equals(status)) {
            return providerTaskId == null || providerTaskId.isBlank();
        }
        return false;
    }

    private static String reasonFor(String status, Map<String, Object> statusPayload) {
        if (JobStatusEnum.CANCELLED.value().equals(status)) {
            return "用户取消";
        }
        if (statusPayload != null && statusPayload.get("error") instanceof Map<?, ?> error) {
            Object message = error.get("message");
            if (message != null && !message.toString().isBlank()) {
                return message.toString();
            }
        }
        return "未提供原因";
    }

    private static String toJson(Map<String, Object> body) {
        try {
            return JSON_MAPPER.writeValueAsString(body);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("计费事件序列化失败", e);
        }
    }
}
