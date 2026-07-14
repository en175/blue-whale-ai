package com.blue.whale.agent.service;

import com.blue.whale.agent.model.dto.ProductEventDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * {@link ProjectEventBus} 单测：进程内 Project 级 SSE 推送。
 * 验证订阅/发布/注销，以及单个订阅者发送失败不影响其他订阅者。
 */
class ProjectEventBusTest {

    private ProjectEventBus bus;

    @BeforeEach
    void setUp() {
        bus = new ProjectEventBus();
    }

    private ProductEventDto sampleEvent(long cursor) {
        return new ProductEventDto(1, "evt_" + cursor, cursor, "project.created", 1L,
                "project", "1", 0, null, null, LocalDateTime.now(), Map.of("name", "A"));
    }

    @Test
    void publishDeliversToAllSubscribers() throws Exception {
        SseEmitter e1 = spy(new SseEmitter());
        SseEmitter e2 = spy(new SseEmitter());
        bus.subscribe(1L, e1);
        bus.subscribe(1L, e2);
        ProductEventDto event = sampleEvent(1L);

        bus.publish(1L, event);

        verify(e1).send(any());
        verify(e2).send(any());
    }

    @Test
    void publishNoopWhenNoSubscribers() {
        // 无订阅者时不抛异常
        bus.publish(1L, sampleEvent(1L));
    }

    @Test
    void singleSubscriberFailureDoesNotAffectOthers() throws Exception {
        SseEmitter failing = spy(new SseEmitter());
        SseEmitter healthy = spy(new SseEmitter());
        // 模拟第一个订阅者发送失败抛 IOException
        doThrow(new IOException("broken")).when(failing).send(any());

        bus.subscribe(1L, failing);
        bus.subscribe(1L, healthy);

        bus.publish(1L, sampleEvent(1L));

        // 失败的订阅者被 completeWithError，健康的订阅者仍收到
        verify(failing).completeWithError(any());
        verify(healthy).send(any());
    }

    @Test
    void unsubscribeOnCompletion() {
        SseEmitter emitter = new SseEmitter();
        bus.subscribe(1L, emitter);
        emitter.complete();

        // 完成后发布不应抛异常，且不再投递给已完成的 emitter
        bus.publish(1L, sampleEvent(1L));
    }
}
