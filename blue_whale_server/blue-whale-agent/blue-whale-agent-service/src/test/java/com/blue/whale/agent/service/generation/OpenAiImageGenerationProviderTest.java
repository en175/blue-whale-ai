package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.service.ProjectAssetContentService;
import com.blue.whale.agent.model.dto.AssetContent;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import okhttp3.OkHttpClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OpenAiImageGenerationProviderTest {

    private static final byte[] ONE_PIXEL_PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void textOnlyRequestUsesGenerations() throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        AtomicReference<String> requestPath = new AtomicReference<>();
        AtomicReference<JsonNode> requestBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        server = startServer(exchange -> {
            requestPath.set(exchange.getRequestURI().getPath());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            requestBody.set(objectMapper.readTree(exchange.getRequestBody()));
            respond(exchange, 200, "{\"created\":1,\"data\":[{\"b64_json\":\""
                    + Base64.getEncoder().encodeToString(ONE_PIXEL_PNG) + "\"}],\"usage\":{}}");
        });

        GenerationAdapterProperties properties = properties();
        OpenAiImageGenerationProvider provider = new OpenAiImageGenerationProvider(
                new OkHttpClient(), objectMapper, mock(ProjectAssetContentService.class), properties);

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "a blue whale", "aspect_ratio", "1:1")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.SUCCESS);
        assertThat(result.content()).isEqualTo(ONE_PIXEL_PNG);
        assertThat(result.mimeType()).isEqualTo("image/png");
        assertThat(result.width()).isEqualTo(1);
        assertThat(result.height()).isEqualTo(1);
        assertThat(requestPath.get()).isEqualTo("/v1/images/generations");
        assertThat(authorization.get()).isEqualTo("Bearer test-key");
        assertThat(requestBody.get().path("model").asText()).isEqualTo("gpt-image-2");
        assertThat(requestBody.get().path("prompt").asText()).isEqualTo("a blue whale");
        assertThat(requestBody.get().path("size").asText()).isEqualTo("1024x1024");
        assertThat(requestBody.get().path("output_format").asText()).isEqualTo("png");
        assertThat(requestBody.get().path("n").asInt()).isEqualTo(1);
    }

    @Test
    void referenceAssetsUseEditsWithOwnedAssetBytes() throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        AtomicReference<String> requestPath = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<String> multipartBody = new AtomicReference<>();
        server = startServer(exchange -> {
            requestPath.set(exchange.getRequestURI().getPath());
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            multipartBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.ISO_8859_1));
            respond(exchange, 200, "{\"data\":[{\"b64_json\":\""
                    + Base64.getEncoder().encodeToString(ONE_PIXEL_PNG) + "\"}]}");
        });
        ProjectAssetContentService assetContentService = mock(ProjectAssetContentService.class);
        when(assetContentService.read(7L, 91L, 11L))
                .thenReturn(new AssetContent(ONE_PIXEL_PNG, "image/png"));
        when(assetContentService.read(7L, 92L, 11L))
                .thenReturn(new AssetContent(ONE_PIXEL_PNG, "image/png"));
        OpenAiImageGenerationProvider provider = new OpenAiImageGenerationProvider(
                new OkHttpClient(), objectMapper, assetContentService, properties());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of(
                        "prompt", "add a moon",
                        "aspect_ratio", "16:9",
                        "reference_asset_ids", List.of(91L, 92L))));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.SUCCESS);
        assertThat(requestPath.get()).isEqualTo("/v1/images/edits");
        assertThat(contentType.get()).startsWith("multipart/form-data; boundary=");
        assertThat(multipartBody.get()).contains("name=\"model\"")
                .contains("gpt-image-2")
                .contains("name=\"prompt\"")
                .contains("add a moon")
                .contains("name=\"image[]\"; filename=\"asset-91.png\"")
                .contains("name=\"image[]\"; filename=\"asset-92.png\"")
                .contains("name=\"size\"")
                .contains("1536x1024");
        verify(assetContentService).read(7L, 91L, 11L);
        verify(assetContentService).read(7L, 92L, 11L);
    }

    @Test
    void invalidReferenceAssetIdsFailBeforeCallingProvider() throws Exception {
        server = startServer(exchange -> respond(exchange, 500, "{}"));
        ProjectAssetContentService assetContentService = mock(ProjectAssetContentService.class);
        OpenAiImageGenerationProvider provider = new OpenAiImageGenerationProvider(
                new OkHttpClient(), new ObjectMapper(), assetContentService, properties());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "edit", "reference_asset_ids", List.of(0L, 2L))));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("invalid_request");
        verifyNoInteractions(assetContentService);
    }

    @Test
    void providerRateLimitIsNormalizedWithoutLeakingRawError() throws Exception {
        server = startServer(exchange -> respond(exchange, 429,
                "{\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"secret upstream detail\"}}"));
        OpenAiImageGenerationProvider provider = new OpenAiImageGenerationProvider(
                new OkHttpClient(), new ObjectMapper(), mock(ProjectAssetContentService.class), properties());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "a whale")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("provider_rate_limited");
        assertThat(result.errorMessage()).doesNotContain("secret upstream detail");
    }

    @Test
    void invalidImageBytesAreRejected() throws Exception {
        server = startServer(exchange -> respond(exchange, 200,
                "{\"data\":[{\"b64_json\":\""
                        + Base64.getEncoder().encodeToString("not an image".getBytes(StandardCharsets.UTF_8))
                        + "\"}]}"));
        OpenAiImageGenerationProvider provider = new OpenAiImageGenerationProvider(
                new OkHttpClient(), new ObjectMapper(), mock(ProjectAssetContentService.class), properties());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "a whale")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("invalid_provider_result");
    }

    @Test
    void unavailableReferenceAssetBecomesStableFailure() throws Exception {
        server = startServer(exchange -> respond(exchange, 500, "{}"));
        ProjectAssetContentService assetContentService = mock(ProjectAssetContentService.class);
        when(assetContentService.read(7L, 91L, 11L)).thenThrow(
                new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "upstream private detail"));
        OpenAiImageGenerationProvider provider = new OpenAiImageGenerationProvider(
                new OkHttpClient(), new ObjectMapper(), assetContentService, properties());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "edit", "reference_asset_ids", List.of(91L))));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("reference_asset_unavailable");
        assertThat(result.errorMessage()).doesNotContain("upstream private detail");
    }

    private GenerationAdapterProperties properties() {
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.getOpenai().setApiKey("test-key");
        properties.getOpenai().setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.getOpenai().setModel("gpt-image-2");
        properties.getOpenai().setMaxImageBytes(5 * 1024 * 1024);
        return properties;
    }

    private HttpServer startServer(ExchangeHandler handler) throws IOException {
        HttpServer httpServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        httpServer.createContext("/", exchange -> handler.handle(exchange));
        httpServer.start();
        return httpServer;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    @FunctionalInterface
    private interface ExchangeHandler {
        void handle(HttpExchange exchange) throws IOException;
    }
}
