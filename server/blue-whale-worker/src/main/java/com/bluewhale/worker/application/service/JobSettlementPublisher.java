package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.contract.JobStatusEnum;
import com.bluewhale.worker.domain.contract.SettlementUsageLines;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
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
public class JobSettlementPublisher {

    private static final Logger log = LoggerFactory.getLogger(JobSettlementPublisher.class);

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    private static final Set<String> SETTLED_STATUSES = Set.of(
            JobStatusEnum.SUCCEEDED.value(),
            JobStatusEnum.PARTIALLY_SUCCEEDED.value());

    private static final Set<String> REFUNDED_STATUSES = Set.of(
            JobStatusEnum.FAILED.value(),
            JobStatusEnum.CANCELLED.value());

    private final BillingEventPublisher producer;
    private final String completedTopic;
    private final String failedTopic;

    public JobSettlementPublisher(BillingEventPublisher producer, Environment env) {
        this.producer = producer;
        this.completedTopic = env.getProperty("worker.billing.topic-completed", "generation-job-completed");
        this.failedTopic = env.getProperty("worker.billing.topic-failed", "generation-job-failed");
    }

    public static JobSettlementPublisher noop() {
        return new JobSettlementPublisher(BillingEventPublisher.noop(), new StandardEnvironment());
    }

    public void publishTerminal(GenerationJobEntity job, Map<String, Object> statusPayload) {
        publishTerminal(job, statusPayload, null, null);
    }

    public void publishTerminal(GenerationJobEntity job, Map<String, Object> statusPayload,
                                Long upstreamTotalTokens) {
        publishTerminal(job, statusPayload, upstreamTotalTokens, null);
    }

    public void publishTerminal(GenerationJobEntity job, Map<String, Object> statusPayload,
                                Long upstreamTotalTokens, Long upstreamSeconds) {
        String status = job.getStatus();
        if (status == null) {
            return;
        }
        boolean settled = SETTLED_STATUSES.contains(status);
        boolean refunded = REFUNDED_STATUSES.contains(status);

        if (!settled && !refunded) {
            log.warn("非终态作业走到了结算发布口，已跳过：jobId={} status={}", job.getId(), status);
            return;
        }

        String topic = settled ? completedTopic : failedTopic;
        String body = settled
                ? completedBody(job, status, statusPayload, upstreamTotalTokens, upstreamSeconds)
                : failedBody(job, statusPayload);

        try {
            producer.publish(topic, body);
        } catch (Exception e) {
            log.error("计费事件发布失败，该 job 的预扣仍处于冻结状态，需人工处理："
                            + "jobId={} userId={} status={} topic={} —— "
                            + "可用 billing 的 POST /admin/jobs/{id}/settle 或 /refund 兜底",
                    job.getId(), job.getUserId(), status, topic, e);
        }
    }

    private String completedBody(GenerationJobEntity job, String status, Map<String, Object> payload,
                                 Long upstreamTotalTokens, Long upstreamSeconds) {
        int succeededSlots = succeededSlots(payload);
        List<Map<String, Object>> usage =
                SettlementUsageLines.forJob(job, succeededSlots, upstreamTotalTokens, upstreamSeconds);
        if (usage.isEmpty()) {
            log.warn("结算事件报不出用量（job.input 取不到 model_id），将退回按预扣额结算："
                    + "jobId={} type={} 成功槽={}", job.getId(), job.getType(), succeededSlots);
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", job.getId());
        body.put("userId", job.getUserId());
        body.put("status", status);
        body.put("catalogVersion", 0);
        body.put("succeededSlots", succeededSlots);
        body.put("usage", usage);
        return toJson(body);
    }

    private String failedBody(GenerationJobEntity job, Map<String, Object> payload) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", job.getId());
        body.put("userId", job.getUserId());
        body.put("reason", failureReason(payload));
        return toJson(body);
    }

    private static int succeededSlots(Map<String, Object> payload) {
        return payload.get("output_asset_ids") instanceof List<?> assetIds ? assetIds.size() : 0;
    }

    private static String failureReason(Map<String, Object> payload) {
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
