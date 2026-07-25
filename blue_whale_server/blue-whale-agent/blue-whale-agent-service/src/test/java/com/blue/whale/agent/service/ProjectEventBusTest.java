package com.blue.whale.agent.service;

import com.blue.whale.agent.model.entity.ProjectEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.LongStream;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProjectEventBusTest {

    @Mock
    private ProjectEventService eventService;
    @Mock
    private ProjectEventNotifier notifier;

    private ProjectEventBus bus;

    @BeforeEach
    void setUp() {
        bus = new ProjectEventBus(eventService, notifier);
    }

    @Test
    void subscriptionDrainsAllPersistedBatchesBeforeGoingLive() throws Exception {
        List<ProjectEvent> firstBatch = LongStream.rangeClosed(1, 500)
                .mapToObj(this::event)
                .toList();
        when(eventService.eventsAfter(1L, 0L, 500)).thenReturn(firstBatch);
        when(eventService.eventsAfter(1L, 500L, 500)).thenReturn(List.of(event(501L)));
        SseEmitter emitter = org.mockito.Mockito.spy(new SseEmitter());

        bus.subscribe(1L, 0L, emitter);

        verify(emitter, times(501)).send(any(SseEmitter.SseEventBuilder.class));
        verify(eventService).eventsAfter(1L, 0L, 500);
        verify(eventService).eventsAfter(1L, 500L, 500);
    }

    @Test
    void notificationOnlyWakesSubscribersWhichThenReadTheDatabase() throws Exception {
        when(eventService.eventsAfter(1L, 0L, 500))
                .thenReturn(List.of())
                .thenReturn(List.of(event(1L)));
        SseEmitter emitter = org.mockito.Mockito.spy(new SseEmitter());
        bus.subscribe(1L, 0L, emitter);

        bus.notifyProject(1L);

        verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
        verify(notifier).subscribe(any());
    }

    @Test
    void heartbeatDrainsMissedEventsBeforeWritingTheComment() throws Exception {
        when(eventService.eventsAfter(1L, 0L, 500))
                .thenReturn(List.of())
                .thenReturn(List.of(event(1L)));
        SseEmitter emitter = org.mockito.Mockito.spy(new SseEmitter());
        bus.subscribe(1L, 0L, emitter);

        bus.heartbeat(1L, emitter);

        verify(emitter, times(2)).send(any(SseEmitter.SseEventBuilder.class));
    }

    @Test
    void oneBrokenConnectionDoesNotBlockOtherSubscribers() throws Exception {
        when(eventService.eventsAfter(1L, 0L, 500))
                .thenReturn(List.of())
                .thenReturn(List.of())
                .thenReturn(List.of(event(1L)))
                .thenReturn(List.of(event(1L)));
        SseEmitter broken = org.mockito.Mockito.spy(new SseEmitter());
        SseEmitter healthy = org.mockito.Mockito.spy(new SseEmitter());
        bus.subscribe(1L, 0L, broken);
        bus.subscribe(1L, 0L, healthy);
        doThrow(new IOException("broken"))
                .when(broken).send(any(SseEmitter.SseEventBuilder.class));

        bus.notifyProject(1L);

        verify(broken).completeWithError(any());
        verify(healthy).send(any(SseEmitter.SseEventBuilder.class));
    }

    @Test
    void notificationForAnotherProjectDoesNotTouchThisConnection() throws Exception {
        when(eventService.eventsAfter(1L, 0L, 500)).thenReturn(List.of());
        SseEmitter emitter = org.mockito.Mockito.spy(new SseEmitter());
        bus.subscribe(1L, 0L, emitter);

        bus.notifyProject(2L);

        verify(emitter, never()).send(any(SseEmitter.SseEventBuilder.class));
    }

    private ProjectEvent event(long cursor) {
        return new ProjectEvent()
                .setProjectId(1L)
                .setCursor(cursor)
                .setEventId("evt_" + cursor)
                .setEventType("project.renamed")
                .setAggregateType("project")
                .setAggregateId("1")
                .setAggregateVersion((int) cursor)
                .setOccurredAt(LocalDateTime.now())
                .setPayload(Map.of("name", "P" + cursor));
    }
}
