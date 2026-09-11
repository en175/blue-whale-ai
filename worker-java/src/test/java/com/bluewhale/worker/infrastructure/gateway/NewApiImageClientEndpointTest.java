package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient.GeneratedImage;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 出站协议钉桩测试。
 * <p>
 * 覆盖两层：
 * <ul>
 *   <li><b>OPENAI_IMAGES</b>（IKF4LI，gpt-image-2）：无参考图 → {@code /v1/images/generations}
 *       JSON 且<strong>不含</strong> response_format（2026-09-11 实测上游 400
 *       {@code Unknown parameter: 'response_format'}）；有参考图 → {@code /v1/images/edits}
 *       multipart（generations 带 {@code image} 亦被上游 400）；响应只回 b64_json。</li>
 *   <li><b>INLINE_IMAGE</b>（现状，banana/seedream）：恒 generations + body.image 透传。</li>
 * </ul>
 * 超时/连接失败的错误分类政策见契约 §11。
 */
class NewApiImageClientEndpointTest {

    /** 最小 PNG 头（嗅探只认魔数，不做解码）。 */
    private static final byte[] PNG_BYTES = {
            (byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D
    };

    private HttpServer server;
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastContentType = new AtomicReference<>();
    private final AtomicReference<String> responseJson = new AtomicReference<>();
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        responseJson.set("{\"data\":[{\"url\":\"https://gen/x.png\"}]}");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);

        // 参考图下载失败桩（HttpServer 按最长前缀匹配，不会被下面的 "/" 兜底吞掉）
        server.createContext("/missing.png", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });

        // 参考图素材端点（官方协议 multipart 前会先 GET 它）
        server.createContext("/ref.png", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, PNG_BYTES.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(PNG_BYTES);
            }
        });

        server.createContext("/", exchange -> {
            lastPath.set(exchange.getRequestURI().getPath());
            lastContentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream in = exchange.getRequestBody()) {
                in.transferTo(buf);
            }
            lastBody.set(buf.toString(StandardCharsets.UTF_8));
            if (lastBody.get().contains("sleep-trig")) {
                try {
                    Thread.sleep(3000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
            byte[] resp = responseJson.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(resp);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    // ========== OPENAI_IMAGES（gpt-image-2，IKF4LI） ==========

    @Test
    @DisplayName("官方协议·无参考图 → generations JSON，只发官方字段（不含 response_format/stream/tools）")
    void openAiNoRefsUsesGenerationsWithOfficialFieldsOnly() {
        new NewApiImageClient(baseUrl).generate("t", ImageProtocol.OPENAI_IMAGES,
                "gpt-image-2", "猫", 1, "2048x2048", null, false, false, List.of());

        assertThat(lastPath.get()).isEqualTo("/v1/images/generations");
        String body = lastBody.get();
        assertThat(body).contains("\"model\":\"gpt-image-2\"");
        assertThat(body).contains("\"prompt\":\"猫\"");
        assertThat(body).contains("\"size\":\"2048x2048\"");
        assertThat(body).contains("\"n\":1");
        // 上游实测拒绝 response_format / watermark；非官方字段一并克制不发
        assertThat(body).doesNotContain("response_format");
        assertThat(body).doesNotContain("\"stream\"");
        assertThat(body).doesNotContain("\"tools\"");
        assertThat(body).doesNotContain("sequential_image_generation");
        assertThat(body).doesNotContain("\"image\"");
    }

    @Test
    @DisplayName("官方协议·有参考图 → edits multipart，参考图作文件字节上传，模型名不换")
    void openAiWithRefsUsesEditsMultipart() {
        new NewApiImageClient(baseUrl).generate("t", ImageProtocol.OPENAI_IMAGES,
                "gpt-image-2", "改成蓝色调", 1, "1024x1024", null, false, false,
                List.of(baseUrl + "/ref.png"));

        assertThat(lastPath.get()).isEqualTo("/v1/images/edits");
        assertThat(lastContentType.get()).startsWith("multipart/form-data; boundary=");
        String body = lastBody.get();
        assertThat(body).contains("name=\"model\"");
        assertThat(body).contains("gpt-image-2");
        assertThat(body).contains("name=\"prompt\"");
        assertThat(body).contains("name=\"image\"; filename=\"image-1.png\"");
        assertThat(body).contains("Content-Type: image/png");
        assertThat(body).doesNotContain("response_format");
    }

    @Test
    @DisplayName("官方协议·参考图下载失败 → provider_failed 瞬态（发生在提交上游之前，零扣费风险）")
    void openAiRefDownloadFailureIsTransient() {
        ImageProviderError error = null;
        try {
            new NewApiImageClient(baseUrl).generate("t", ImageProtocol.OPENAI_IMAGES,
                    "gpt-image-2", "猫", 1, null, null, false, false,
                    List.of(baseUrl + "/missing.png"));
        } catch (ImageProviderError e) {
            error = e;
        }
        assertThat(error).isNotNull();
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("官方协议·b64_json 响应 → 解码为字节 + 魔数嗅探 mime，url 为 null")
    void openAiParsesB64JsonResponse() {
        responseJson.set("{\"data\":[{\"b64_json\":\""
                + Base64.getEncoder().encodeToString(PNG_BYTES) + "\"}]}");

        List<GeneratedImage> images = new NewApiImageClient(baseUrl).generate("t",
                ImageProtocol.OPENAI_IMAGES, "gpt-image-2", "猫", 1, null, null, false, false,
                List.of());

        assertThat(images).hasSize(1);
        assertThat(images.get(0).url()).isNull();
        assertThat(images.get(0).content()).isEqualTo(PNG_BYTES);
        assertThat(images.get(0).mime()).isEqualTo("image/png");
    }

    @Test
    @DisplayName("b64_json 解不开 → 丢弃该元素，不炸整批（与 url 缺失同款宽容）")
    void invalidB64ElementIsDropped() {
        responseJson.set("{\"data\":[{\"b64_json\":\"不是base64!!\"},"
                + "{\"b64_json\":\"" + Base64.getEncoder().encodeToString(PNG_BYTES) + "\"}]}");

        List<GeneratedImage> images = new NewApiImageClient(baseUrl).generate("t",
                ImageProtocol.OPENAI_IMAGES, "gpt-image-2", "猫", 1, null, null, false, false,
                List.of());

        assertThat(images).hasSize(1);
        assertThat(images.get(0).mime()).isEqualTo("image/png");
    }

    // ========== INLINE_IMAGE（现状，banana/seedream） ==========

    @Test
    @DisplayName("inline 形态·无参考图 → generations，body 无 image 字段")
    void inlineNoRefsUsesGenerationsWithoutImage() {
        List<GeneratedImage> images = new NewApiImageClient(baseUrl)
                .generate("t", ImageProtocol.INLINE_IMAGE, "gpt-image-2", "猫", 1,
                        "1024x1024", null, false, false, List.of());

        assertThat(lastPath.get()).isEqualTo("/v1/images/generations");
        assertThat(lastBody.get()).doesNotContain("\"image\"");
        assertThat(images).hasSize(1);
    }

    @Test
    @DisplayName("inline 形态·单张参考图 → 仍 generations，image=URL 字符串（非 multipart）")
    void inlineSingleRefKeepsGenerationsWithStringImage() {
        new NewApiImageClient(baseUrl).generate("t", ImageProtocol.INLINE_IMAGE,
                "nano-banana-2-i2i", "猫", 1,
                "1024x1024", null, false, false, List.of("https://a/1.png"));

        assertThat(lastPath.get()).isEqualTo("/v1/images/generations");
        assertThat(lastBody.get()).contains("\"image\":\"https://a/1.png\"");
    }

    @Test
    @DisplayName("inline 形态·多张参考图 → image=数组；字段序 image 在 quality 之后 n 之前（TS 逐字）")
    void inlineMultiRefsUseArrayImage() {
        new NewApiImageClient(baseUrl).generate("t", ImageProtocol.INLINE_IMAGE,
                "nano-banana-2-i2i", "猫", 1,
                null, "hd", false, false, List.of("https://a/1.png", "https://a/2.png"));

        assertThat(lastPath.get()).isEqualTo("/v1/images/generations");
        String body = lastBody.get();
        assertThat(body).contains("\"image\":[\"https://a/1.png\",\"https://a/2.png\"]");
        assertThat(body.indexOf("\"quality\"")).isLessThan(body.indexOf("\"image\""));
        assertThat(body.indexOf("\"image\"")).isLessThan(body.indexOf("\"n\""));
    }

    // ========== 错误分类政策（契约 §11） ==========

    @Test
    @DisplayName("读超时 → provider_timeout 终态不重试（2026-09-11 政策：重试=双扣风险）")
    void readTimeoutIsTerminalProviderTimeout() {
        NewApiImageClient client = new NewApiImageClient(baseUrl, 300);
        ImageProviderError error = null;
        try {
            client.generate("t", ImageProtocol.INLINE_IMAGE, "nano-banana-2-i2i",
                    "sleep-trig 猫", 1, null, null, false, false, List.of());
        } catch (ImageProviderError e) {
            error = e;
        }
        assertThat(error).isNotNull();
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_TIMEOUT);
    }

    @Test
    @DisplayName("连接失败（请求未达上游，零扣费风险）→ provider_failed 瞬态可重试")
    void connectFailureIsTransientProviderFailed() {
        // 端口 1 无监听 → ConnectException（非 SocketTimeout）→ 通用 IO 分支归瞬态。
        NewApiImageClient client = new NewApiImageClient("http://127.0.0.1:1", 300);
        ImageProviderError error = null;
        try {
            client.generate("t", ImageProtocol.INLINE_IMAGE, "nano-banana-2-i2i", "猫", 1,
                    null, null, false, false, List.of());
        } catch (ImageProviderError e) {
            error = e;
        }
        assertThat(error).isNotNull();
        assertThat(error.getCode()).isEqualTo(GenerationError.ERROR_PROVIDER_FAILED);
    }

    // ========== 工具方法 ==========

    @Test
    @DisplayName("mime 嗅探：魔数优先于响应头，未知格式兜底 image/png")
    void sniffMimePrefersMagicBytes() {
        assertThat(NewApiImageClient.sniffImageMime(PNG_BYTES, "image/webp")).isEqualTo("image/png");
        assertThat(NewApiImageClient.sniffImageMime(
                new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}, null)).isEqualTo("image/jpeg");
        assertThat(NewApiImageClient.sniffImageMime(
                new byte[]{0x00, 0x01}, "image/webp; charset=utf-8")).isEqualTo("image/webp");
        assertThat(NewApiImageClient.sniffImageMime(new byte[]{0x00, 0x01}, null))
                .isEqualTo("image/png");
    }
}
