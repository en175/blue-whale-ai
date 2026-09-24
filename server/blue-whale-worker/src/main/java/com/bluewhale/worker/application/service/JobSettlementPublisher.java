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
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 生成作业到达终态时，向 billing 发结算 / 返还事件。
 *
 * <h2>它在链路里的位置</h2>
 *
 * 预扣发生在 job 创建时（business-api 调 billing 的 gRPC {@code Hold}），
 * 那笔钱之后一直**冻着**。把它解冻的只有一个动作：job 到达终态时发这条事件。
 * 所以这里漏发一次 = 一个用户的钱永远冻着，而且没有任何自动补偿会来救。
 *
 * <h2>为什么带 JSON 而不是 protobuf 二进制</h2>
 *
 * 与 {@link com.bluewhale.worker.infrastructure.mq.JobEventPayload}（billing 侧）
 * 同一份 wire 格式：camelCase 字段名、JSON 编码。字段名与
 * {@code contracts/proto/billing/v1/events.proto} 逐字一致，
 * 这样从任一侧看过去都是同一套名字。
 *
 * <p>⚠️ {@code catalogVersion} 发 {@code 0}：worker **不知道**它，也不该知道——
 * 定价版本的权威副本冻结在 billing 自己的预留行上，结算时从那里读。
 * 契约里保留该字段是为了让事件本身可自证（排查时不必反查 DB），不是结算的输入。
 *
 * <h2>发布失败怎么办：不回滚终态，只亮红灯</h2>
 *
 * 终态写入（guard CAS + 槽位 + 日志 + project_events）是**用户能看到的事实**，
 * 事件只是通知。让通知失败回滚终态，代价是 job 退回 {@code processing} →
 * 租约到期 → recovery 重新领取 → **重新向上游调一次生成**（真金白银）。
 * 那比「一笔钱冻着等人处理」更糟。
 *
 * <p>所以：吞掉异常、ERROR 日志。冻着的预留有两条人工兜底——
 * billing 的 {@code POST /admin/jobs/{id}/settle} 与 {@code /refund}，
 * 报错日志里的 jobId 就是投进去的参数。
 */
@Service
public class JobSettlementPublisher {

    private static final Logger log = LoggerFactory.getLogger(JobSettlementPublisher.class);

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    /** 走 {@code generation.job.completed}（触发结算）的状态。 */
    private static final Set<String> SETTLED_STATUSES = Set.of(
            JobStatusEnum.SUCCEEDED.value(),
            JobStatusEnum.PARTIALLY_SUCCEEDED.value());

    /** 走 {@code generation.job.failed}（触发全额返还）的状态。 */
    private static final Set<String> REFUNDED_STATUSES = Set.of(
            JobStatusEnum.FAILED.value(),
            JobStatusEnum.CANCELLED.value());

    private final BillingEventPublisher producer;
    private final String completedTopic;
    private final String failedTopic;

    public JobSettlementPublisher(BillingEventPublisher producer, Environment env) {
        this.producer = producer;
        // 默认值与 billing 侧 consumer 的默认值成对（billing.mq.topic-completed/failed）；
        // 两边都改才算改，只改一边的表现是「事件发出去了但没人消费」——静默且致命。
        this.completedTopic = env.getProperty("worker.billing.topic-completed", "generation.job.completed");
        this.failedTopic = env.getProperty("worker.billing.topic-failed", "generation.job.failed");
    }

    /**
     * 什么都没接线的实例（测试直连构造 / 本地无 MQ 时用）。
     *
     * <p>{@code JobStateMachineService} 的 7-mapper 旧构造仍被测试直接调用，
     * 那条路径上没有 Spring 容器、也就没有 {@code BillingEventPublisher} 这个 bean。
     * 让它在编译期就断开比给测试塞一个假 MQ 干净。
     *
     * <p>⚠️ 走这条路径的测试**看不到结算事件**。要断言事件内容就显式 new 一个真的
     * {@code JobSettlementPublisher} 传进去——别在这里加开关。
     */
    public static JobSettlementPublisher noop() {
        return new JobSettlementPublisher(BillingEventPublisher.noop(), new StandardEnvironment());
    }

    /**
     * 终态收口：按状态决定结算还是返还，然后发布。
     *
     * @param job           已写入终态的作业行（userId 从其取）
     * @param statusPayload ★ 与 {@code status_changed} **同一个** payload——
     *                      结算需要的成功槽数、失败原因都在里面，另起一份数据源
     *                      就会出现「事件说的成功、结算看到的失败」
     */
    public void publishTerminal(GenerationJobEntity job, Map<String, Object> statusPayload) {
        String status = job.getStatus();
        if (status == null) {
            return;
        }
        boolean settled = SETTLED_STATUSES.contains(status);
        boolean refunded = REFUNDED_STATUSES.contains(status);

        // 非终态（queued / processing）不该走到这里：8 个调用点都在 CAS 守卫之后。
        // 真出现说明有调用点接错了位置，喊出来而不是静默丢弃。
        if (!settled && !refunded) {
            log.warn("非终态作业走到了结算发布口，已跳过：jobId={} status={}", job.getId(), status);
            return;
        }

        String topic = settled ? completedTopic : failedTopic;
        String body = settled
                ? completedBody(job, status, statusPayload)
                : failedBody(job, statusPayload);

        try {
            producer.publish(topic, body);
        } catch (Exception e) {
            // 不回滚（理由见类注释）。ERROR + jobId 是唯一的人工信号。
            log.error("计费事件发布失败，该 job 的预扣仍处于冻结状态，需人工处理："
                            + "jobId={} userId={} status={} topic={} —— "
                            + "可用 billing 的 POST /admin/jobs/{id}/settle 或 /refund 兜底",
                    job.getId(), job.getUserId(), status, topic, e);
        }
    }

    /**
     * {@code generation.job.completed} 的载荷。
     *
     * <p>{@code usage} 发**空数组**：worker 侧尚未按用量维度上报。billing 的
     * {@code SettlementService} 对空用量按**预扣额**结算——这正是媒介类任务
     * （视频/图片按次计费，用量即契约量）的正确取值，不是降级。
     * 这同时被 {@code SettlementService} 的测试钉住。
     *
     * <p>⚠️ 残留缺口：{@code partially_succeeded} 且未报用量时会按全额结算，
     * billing 侧对此打 WARN。要让部分成功按实际槽位收费，得先在这里填上 usage。
     */
    private String completedBody(GenerationJobEntity job, String status, Map<String, Object> payload) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", job.getId());
        body.put("userId", job.getUserId());
        body.put("status", status);
        body.put("catalogVersion", 0);
        body.put("succeededSlots", succeededSlots(payload));
        body.put("usage", List.of());
        return toJson(body);
    }

    /**
     * {@code generation.job.failed} 的载荷。
     *
     * <p>{@code reason} 从 status_changed 的 {@code error} 里取——两条事件说的是
     * 同一件事，理由必须同源，否则运维看到的失败原因和用户看到的对不上。
     */
    private String failedBody(GenerationJobEntity job, Map<String, Object> payload) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", job.getId());
        body.put("userId", job.getUserId());
        body.put("reason", failureReason(payload));
        return toJson(body);
    }

    /**
     * 成功槽数 = 本次终态挂上的产物数。
     *
     * <p>取 {@code output_asset_ids} 的长度而非重查 DB：这就是这次终态**实际写下**的
     * 结果，重查会读到后续重试产生的新行，把两个时点混在一起。
     */
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
            // 序列化一份纯标量 Map 失败说明 Jackson 配置被动了，属于编码错误而非运行时状况
            throw new IllegalStateException("计费事件序列化失败", e);
        }
    }
}
