package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@Service
public class JobSettlementPublisher {

    private static final Logger log = LoggerFactory.getLogger(JobSettlementPublisher.class);

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private static final Set<String> TERMINAL_STATUSES = Set.of(
            JobStatusEnum.SUCCEEDED.value(),
            JobStatusEnum.PARTIALLY_SUCCEEDED.value(),
            JobStatusEnum.FAILED.value(),
            JobStatusEnum.CANCELLED.value());

    private final BillingEventPublisher producer;
    private final String terminalTopic;

    public JobSettlementPublisher(BillingEventPublisher producer, Environment env) {
        this.producer = producer;
        this.terminalTopic = env.getProperty("worker.billing.topic-terminal", "generation-job-terminal");
    }

    public static JobSettlementPublisher noop() {
        return new JobSettlementPublisher(BillingEventPublisher.noop(), new StandardEnvironment());
    }

    public void publishTerminal(GenerationJobEntity job, Map<String, Object> statusPayload) {
        String status = job.getStatus();
        if (status == null || !TERMINAL_STATUSES.contains(status)) {
            return;
        }
        try {
            producer.publish(terminalTopic, terminalBody(job, statusPayload, status));
        } catch (Exception e) {
            log.error("终态事件发布失败，该 job 已在提交时扣款、失败/取消需人工返还："
                            + "jobId={} userId={} status={} topic={} —— "
                            + "可用 billing 的 POST /admin/credits/jobs/{id}/refund 兜底",
                    job.getId(), job.getUserId(), status, terminalTopic, e);
        }
    }

    private String terminalBody(GenerationJobEntity job, Map<String, Object> payload, String status) {
        boolean refund = refundDue(job, status);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", job.getId());
        body.put("userId", job.getUserId());
        body.put("status", status);
        body.put("reason", refund ? failureReason(status, payload) : "");
        body.put("refund", refund);
        return toJson(body);
    }

    private static boolean refundDue(GenerationJobEntity job, String status) {
        if (JobStatusEnum.FAILED.value().equals(status)) {
            return true;
        }
        if (JobStatusEnum.CANCELLED.value().equals(status)) {
            String providerTaskId = job.getProviderTaskId();
            return providerTaskId == null || providerTaskId.isBlank();
        }
        return false;
    }

    private static String failureReason(String status, Map<String, Object> payload) {
        if (JobStatusEnum.CANCELLED.value().equals(status)) {
            return "用户取消";
        }
        if (payload.get("error") instanceof Map<?, ?> error) {
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
