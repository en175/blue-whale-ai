package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationOutboxEntity;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutboxMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.env.MockEnvironment;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TerminalEventOutboxTest {

    private static final String TERMINAL_TOPIC = "generation-job-terminal";

    private final List<String[]> published = new ArrayList<>();

    private final GenerationOutboxMapper outboxMapper = mock(GenerationOutboxMapper.class);

    private final GenerationJobMapper jobMapper = mock(GenerationJobMapper.class);

    private final TerminalEventOutbox outbox = new TerminalEventOutbox(
            outboxMapper,
            jobMapper,
            (topic, body) -> published.add(new String[]{topic, body}),
            new MockEnvironment());

    private static GenerationOutboxEntity row(long id, long jobId, String status, String reason) {
        GenerationOutboxEntity row = new GenerationOutboxEntity();
        row.setId(id);
        row.setJobId(jobId);
        row.setUserId(42L);
        row.setTerminalStatus(status);
        row.setReason(reason);
        row.setSendState(GenerationOutboxEntity.STATE_PENDING);
        row.setAttempts(0);
        return row;
    }

    @BeforeEach
    void pendingRows() {
        when(outboxMapper.listPending(anyInt())).thenReturn(List.of());
    }

    @Test
    @DisplayName("★ 投递成功：发一条终态事件并置 sent")
    void 投递成功置sent() {
        GenerationOutboxEntity row = row(1L, 801L, "failed", "上游挂了");
        when(outboxMapper.listPending(100)).thenReturn(List.of(row));

        outbox.drain(100);

        assertThat(published).hasSize(1);
        assertThat(published.get(0)[0]).isEqualTo(TERMINAL_TOPIC);
        assertThat(published.get(0)[1])
                .contains("\"jobId\":801")
                .contains("\"userId\":42")
                .contains("\"status\":\"failed\"")
                .contains("\"refund\":true");
        verify(outboxMapper).markSent(1L);
    }

    @Test
    @DisplayName("★ 投递失败：保持 pending 下一轮再试，只记 attempts")
    void 投递失败保持pending() {
        GenerationOutboxEntity row = row(2L, 802L, "failed", "上游挂了");
        when(outboxMapper.listPending(100)).thenReturn(List.of(row));
        BillingEventPublisher broken = (topic, body) -> {
            throw new IllegalStateException("mq down");
        };
        TerminalEventOutbox degraded = new TerminalEventOutbox(
                outboxMapper, jobMapper, broken, new MockEnvironment());

        degraded.drain(100);

        verify(outboxMapper, never()).markSent(anyLong());
        verify(outboxMapper).bumpAttempts(2L);
    }

    @Test
    @DisplayName("成功不退款：succeeded 的 refund=false 且 reason 清空")
    void 成功不退款() {
        when(outboxMapper.listPending(100))
                .thenReturn(List.of(row(3L, 803L, "succeeded", "未提供原因")));

        outbox.drain(100);

        assertThat(published.get(0)[1]).contains("\"refund\":false").contains("\"reason\":\"\"");
    }

    @Test
    @DisplayName("★ 取消看上游真实结果：上游已接手（provider_task_id 非空）不退款")
    void 取消已派发不退款() {
        when(outboxMapper.listPending(100))
                .thenReturn(List.of(row(4L, 804L, "cancelled", "用户取消")));
        when(jobMapper.findProviderTaskId(804L)).thenReturn("upstream-1");

        outbox.drain(100);

        assertThat(published.get(0)[1]).contains("\"refund\":false");
    }

    @Test
    @DisplayName("★ 取消且未派发上游 → 退款")
    void 取消未派发退款() {
        when(outboxMapper.listPending(100))
                .thenReturn(List.of(row(5L, 805L, "cancelled", "用户取消")));
        when(jobMapper.findProviderTaskId(805L)).thenReturn(null);

        outbox.drain(100);

        assertThat(published.get(0)[1])
                .contains("\"refund\":true")
                .contains("\"reason\":\"用户取消\"");
    }

    @Test
    @DisplayName("非终态不落行 —— 这张表只装终态事件")
    void 非终态不落行() {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(806L);
        job.setUserId(42L);
        job.setStatus("processing");

        outbox.enqueue(job, java.util.Map.of());

        verify(outboxMapper, never()).insert(any(GenerationOutboxEntity.class));
    }

    @Test
    @DisplayName("★ 超长错误信息截断到列宽 —— 否则 insert 抛错会连带回滚整笔终态写入，任务永远收不了口")
    void 超长原因截断到列宽() {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(900L);
        job.setUserId(42L);
        job.setStatus("failed");

        outbox.enqueue(job, java.util.Map.of("error",
                java.util.Map.of("message", "上游返回的整段响应体".repeat(80))));

        ArgumentCaptor<GenerationOutboxEntity> captor =
                ArgumentCaptor.forClass(GenerationOutboxEntity.class);
        verify(outboxMapper).insert(captor.capture());
        assertThat(captor.getValue().getReason()).hasSize(512);
    }

    @Test
    @DisplayName("topic 可配：worker.billing.topic-terminal")
    void topic可配() {
        when(outboxMapper.listPending(100)).thenReturn(List.of(row(6L, 806L, "failed", "挂了")));
        TerminalEventOutbox custom = new TerminalEventOutbox(
                outboxMapper, jobMapper,
                (topic, body) -> published.add(new String[]{topic, body}),
                new MockEnvironment().withProperty("worker.billing.topic-terminal", "custom.terminal"));

        custom.drain(100);

        assertThat(published.get(0)[0]).isEqualTo("custom.terminal");
    }
}
