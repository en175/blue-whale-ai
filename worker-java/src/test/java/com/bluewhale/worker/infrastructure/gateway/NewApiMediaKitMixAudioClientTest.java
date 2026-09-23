package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.AudioMixContract;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class NewApiMediaKitMixAudioClientTest {
    private HttpServer server;
    private final AtomicReference<String> requestPath = new AtomicReference<>();
    private final AtomicReference<String> requestBody = new AtomicReference<>();
    private final AtomicReference<String> response = new AtomicReference<>();
    private final AtomicInteger status = new AtomicInteger(200);
    private String baseUrl;

    @BeforeEach
    void start() throws Exception {
        response.set("{\"success\":true,\"task_id\":\"task-9\",\"request_id\":\"req-1\"}");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requestPath.set(exchange.getRequestURI().getPath());
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status.get(), bytes.length);
            try (var body = exchange.getResponseBody()) { body.write(bytes); }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stop() { server.stop(0); }

    @Test
    void submitsOrderedAudioUrlsWithExplicitFormat() {
        var client = new NewApiMediaKitMixAudioClient(baseUrl);
        String taskId = client.submit("sk-token", List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3");
        assertThat(taskId).isEqualTo("task-9");
        assertThat(requestPath.get()).isEqualTo(AudioMixContract.SUBMIT_PATH);
        assertThat(requestBody.get()).contains("\"model\":\"mediakit-mix-audio\"");
        assertThat(requestBody.get()).contains("\"audio_urls\":[\"https://tos/a.mp3\",\"https://tos/b.mp3\"]");
        assertThat(requestBody.get()).contains("\"format\":\"mp3\"");
    }

    @Test
    void pollsTaskResultWithDurationInSeconds() {
        response.set("{\"status\":\"completed\",\"result\":{\"audio_url\":\"https://temporary/out.mp3\",\"duration\":12.5}}");
        var observation = new NewApiMediaKitMixAudioClient(baseUrl).poll("sk-token", "task-9");
        assertThat(requestPath.get()).isEqualTo(AudioMixContract.POLL_PATH_PREFIX + "task-9");
        assertThat(observation.status()).isEqualTo("succeeded");
        assertThat(observation.audioUrl()).isEqualTo("https://temporary/out.mp3");
        assertThat(observation.durationSec()).isEqualTo(12.5);
    }

    @Test
    void submitFailureRetainsUpstreamRequestIdForDiagnosis() {
        status.set(400);
        response.set("{\"success\":false,\"request_id\":\"req-mix-77\",\"error\":{\"code\":\"InvalidParameter\",\"message\":\"bad audio_urls\"}}");
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                new NewApiMediaKitMixAudioClient(baseUrl).submit("sk-token",
                        List.of("https://tos/a.mp3", "https://tos/b.mp3"), "mp3"))
                .hasMessageContaining("bad audio_urls")
                .hasMessageContaining("req-mix-77");
    }

    @Test
    void completedResponseKeepsRequestIdEvenWithoutAudioResult() {
        response.set("{\"status\":\"completed\",\"request_id\":\"req-mix-88\",\"result\":{}}");
        var observation = new NewApiMediaKitMixAudioClient(baseUrl).poll("sk-token", "task-9");
        assertThat(observation.requestId()).isEqualTo("req-mix-88");
        assertThat(observation.audioUrl()).isNull();
    }
}
