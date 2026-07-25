package com.blue.whale.agent.service;

import com.blue.whale.agent.common.web.PublicRequestId;
import com.blue.whale.agent.common.web.PublicRequestIdFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter.DataWithMediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JobStreamBusTest {

    @AfterEach
    void clearRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void liveErrorUsesSubscriptionRequestId() {
        JobStreamBus bus = new JobStreamBus();
        CapturingSseEmitter emitter = new CapturingSseEmitter();
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(PublicRequestId.class.getName(), "req_live_subscription");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        bus.subscribe(7L, emitter);

        RequestContextHolder.resetRequestAttributes();
        bus.emit(7L, SsePayload.error("pending_reconciliation"));

        assertThat(emitter.lastPayload().error())
                .containsEntry("request_id", "req_live_subscription");
    }

    @Test
    void missingRequestIdRejectsSubscription() {
        JobStreamBus bus = new JobStreamBus();

        assertThatThrownBy(() -> bus.subscribe(7L, new CapturingSseEmitter()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("SSE 订阅缺少 request_id");
    }

    @Test
    void replayedErrorUsesReconnectRequestId() {
        JobStreamBus bus = new JobStreamBus();
        CapturingSseEmitter firstEmitter = subscribe(bus, 7L, "req_first_subscription");
        bus.emit(7L, SsePayload.error("pending_reconciliation"));
        bus.complete(7L);

        CapturingSseEmitter reconnectEmitter = subscribe(bus, 7L, "req_reconnect_subscription");

        assertThat(firstEmitter.lastPayload().error())
                .containsEntry("request_id", "req_first_subscription");
        assertThat(reconnectEmitter.lastPayload().error())
                .containsEntry("request_id", "req_reconnect_subscription")
                .containsEntry("code", firstEmitter.lastPayload().error().get("code"))
                .containsEntry("message", firstEmitter.lastPayload().error().get("message"))
                .containsEntry("budget_effect",
                        firstEmitter.lastPayload().error().get("budget_effect"));
    }

    @Test
    void sharedErrorIsCopiedPerSubscriberWithoutMutation() {
        JobStreamBus bus = new JobStreamBus();
        CapturingSseEmitter firstEmitter = subscribe(bus, 7L, "req_subscriber_a");
        CapturingSseEmitter secondEmitter = subscribe(bus, 7L, "req_subscriber_b");
        RequestContextHolder.resetRequestAttributes();
        SsePayload sharedPayload = SsePayload.error("pending_reconciliation");

        bus.emit(7L, sharedPayload);

        assertThat(firstEmitter.lastPayload().error())
                .containsEntry("request_id", "req_subscriber_a");
        assertThat(secondEmitter.lastPayload().error())
                .containsEntry("request_id", "req_subscriber_b");
        assertThat(firstEmitter.lastPayload()).isNotSameAs(secondEmitter.lastPayload());
        assertThat(sharedPayload.error()).containsEntry("request_id", null);
    }

    @Test
    void successEventsRemainRequestNeutralAndUnchanged() {
        JobStreamBus bus = new JobStreamBus();
        CapturingSseEmitter emitter = subscribe(bus, 7L, "req_success_subscription");
        SsePayload image = SsePayload.image(0, 11L, "https://asset.invalid/11");
        SsePayload done = SsePayload.done(null);

        bus.emit(7L, image);
        bus.emit(7L, done);

        assertThat(emitter.payload(0)).isSameAs(image);
        assertThat(emitter.payload(1)).isSameAs(done);
        assertThat(image.error()).isNull();
        assertThat(done.error()).isNull();
    }

    @Test
    void filterGeneratedRequestIdOverridesUntrustedHeaderAndMatchesSseError() throws Exception {
        JobStreamBus bus = new JobStreamBus();
        CapturingSseEmitter emitter = new CapturingSseEmitter();
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Request-Id", "req_untrusted_client_value");
        MockHttpServletResponse response = new MockHttpServletResponse();

        new PublicRequestIdFilter().doFilter(request, response, (ignoredRequest, ignoredResponse) -> {
            RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
            bus.subscribe(7L, emitter);
        });
        RequestContextHolder.resetRequestAttributes();
        bus.emit(7L, SsePayload.error("pending_reconciliation"));

        String responseRequestId = response.getHeader("X-Request-Id");
        assertThat(responseRequestId)
                .startsWith("req_")
                .isNotEqualTo("req_untrusted_client_value");
        assertThat(emitter.lastPayload().error())
                .containsEntry("request_id", responseRequestId);
    }

    @Test
    void producerErrorPayloadsRemainRequestNeutral() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(PublicRequestId.class.getName(), "req_producer_thread");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        SsePayload error = SsePayload.error("pending_reconciliation");
        SsePayload imageFailed = SsePayload.imageFailed(0, "reserved");

        assertThat(error.error()).containsEntry("request_id", null);
        assertThat(imageFailed.error()).containsEntry("request_id", null);
    }

    @Test
    void sharedErrorMapIsImmutable() {
        SsePayload payload = SsePayload.error("pending_reconciliation");

        assertThatThrownBy(() -> payload.error().put("request_id", "req_mutated"))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    private CapturingSseEmitter subscribe(JobStreamBus bus, Long jobId, String requestId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(PublicRequestId.class.getName(), requestId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        CapturingSseEmitter emitter = new CapturingSseEmitter();
        bus.subscribe(jobId, emitter);
        RequestContextHolder.resetRequestAttributes();
        return emitter;
    }

    private static final class CapturingSseEmitter extends SseEmitter {

        private final List<SsePayload> payloads = new ArrayList<>();

        @Override
        public void send(SseEventBuilder builder) {
            for (DataWithMediaType item : builder.build()) {
                if (item.getData() instanceof SsePayload payload) {
                    payloads.add(payload);
                }
            }
        }

        private SsePayload lastPayload() {
            return payloads.get(payloads.size() - 1);
        }

        private SsePayload payload(int index) {
            return payloads.get(index);
        }
    }
}
