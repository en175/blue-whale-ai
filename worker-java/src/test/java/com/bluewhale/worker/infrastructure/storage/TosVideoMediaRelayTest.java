package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.PutObjectACLInput;
import com.volcengine.tos.model.object.PutObjectInput;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 流式转存（IKHJRC 审查修复 P2）：家族的字节数组路径把结果整段读进堆，上限 200MB 是与堆绑死的
 * 常量；抠像工具成品是 10 分钟档重编码视频（WEBM 带 alpha 可大于源），而源素材上限本身就是
 * 200MB——成品超 200MiB 撞上本地转存即失败、原参数重试救不回来。本套件钉三件事：
 * <ol>
 *   <li>超过 200MiB 的成品**能**转存（上限按调用方工具口径，不是家族常量）</li>
 *   <li>超过调用方上限即拒（错误信息带 MB），且失败路径不留临时文件</li>
 *   <li>与字节数组路径同契约：mime 校验 / 空内容拒 / HTTP 错误透传 / key 与 ACL 同款 /
 *       md5 两种算法逐字节相等（分块算 md5 不得偏离 {@code computeFileMd5} 口径）</li>
 * </ol>
 * 桩服务用 JDK 自带 HttpServer（网关客户端测试同款），TOS 用 mock——本套件不打真实网络。
 */
class TosVideoMediaRelayTest {

    /** 桩服务块大小 1MiB：body 由同一个块重复而成，测试侧不占大内存。 */
    private static final int BLOCK_BYTES = 1024 * 1024;

    private HttpServer server;

    private static byte[] patternBlock() {
        byte[] block = new byte[BLOCK_BYTES];
        for (int i = 0; i < BLOCK_BYTES; i++) {
            block[i] = (byte) (i % 251);
        }
        return block;
    }

    /** 本地桩服务：固定响应头 + 重复块 body（固定 Content-Length，不缓冲整段）。 */
    private String serve(String contentType, int status, long bodyBytes, byte[] block) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", contentType);
            if (status >= 400) {
                byte[] body = "not found".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(status, body.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(body);
                }
                return;
            }
            exchange.sendResponseHeaders(status, bodyBytes);
            try (OutputStream out = exchange.getResponseBody()) {
                long remaining = bodyBytes;
                while (remaining > 0) {
                    int chunk = (int) Math.min(block.length, remaining);
                    out.write(block, 0, chunk);
                    remaining -= chunk;
                }
            }
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/out.bin";
    }

    /**
     * 停流桩（IKHSFC）：发响应头 + 可选首块后挂住连接——连接保持、正文停止发送、不关闭，
     * 模拟上游「已返回响应头但停流」的真实阻塞输入（不是 mock 探针）。首块取 64KiB（超内核
     * socket 缓冲必已送达），保证客户端确实进入「读过头块、阻塞在下一个 read」的状态。
     */
    private String serveStalled(String contentType, int status, long declaredLength, int firstBytes)
            throws IOException {
        byte[] block = patternBlock();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(status, declaredLength);
            try (OutputStream out = exchange.getResponseBody()) {
                if (firstBytes > 0) {
                    out.write(block, 0, firstBytes);
                }
                Thread.sleep(30_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/out.bin";
    }

    /** 上传侧 mock：记录 PutObjectInput 并在调用内经流式读完（完成后 relay 会关流）。 */
    private static List<PutObjectInput> captureUploads(TOSV2 client, AtomicLong uploadedBytes) {
        List<PutObjectInput> uploads = new ArrayList<>();
        doAnswer(invocation -> {
            PutObjectInput input = invocation.getArgument(0);
            uploads.add(input);
            long total = 0;
            try (InputStream in = input.getContent()) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                }
            }
            uploadedBytes.set(total);
            return null;
        }).when(client).putObject(any(PutObjectInput.class));
        return uploads;
    }

    /**
     * 系统临时目录里本转存器留下的文件。{@code java.io.tmpdir} 在 JVM 启动即冻结（探针实证：
     * 运行时改属性不改变落点），故清理只能「前后对比」验证。
     */
    private static List<String> relayTempFiles() throws IOException {
        Path tmp = Path.of(System.getProperty("java.io.tmpdir"));
        try (var files = Files.list(tmp)) {
            return files.map(path -> path.getFileName().toString())
                    .filter(name -> name.startsWith("video-relay-"))
                    .sorted()
                    .toList();
        }
    }

    private static String expectedMd5(byte[] block, int blockCount) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("MD5");
        for (int i = 0; i < blockCount; i++) {
            digest.update(block);
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    @DisplayName("超过 200MiB 的成品可转存：上限按调用方工具口径（抠像 1GiB），不吃家族 200MB 常量")
    void persistStreaming_acceptsResultAboveFamilyCap() throws Exception {
        long payloadBytes = 201L * 1024 * 1024;
        byte[] block = patternBlock();
        String url = serve("video/webm", 200, payloadBytes, block);
        TOSV2 client = mock(TOSV2.class);
        AtomicLong uploadedBytes = new AtomicLong();
        List<PutObjectInput> uploads = captureUploads(client, uploadedBytes);
        List<String> tempBefore = relayTempFiles();

        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES);

        // 前提钉死：这段成品确实超过家族上限，且抠像口径容得下
        assertThat(payloadBytes).isGreaterThan(TosVideoMediaRelay.MAX_VIDEO_BYTES);
        assertThat(VideoMattingContract.MAX_RESULT_BYTES).isGreaterThan(payloadBytes);
        assertThat(stored.size()).isEqualTo(payloadBytes);
        assertThat(uploadedBytes.get()).isEqualTo(payloadBytes);
        assertThat(uploads).hasSize(1);
        assertThat(uploads.get(0).getContentLength()).isEqualTo(payloadBytes);
        assertThat(uploads.get(0).getKey()).startsWith("generated/9/video/").endsWith(".webm");
        assertThat(stored.md5()).isEqualTo(expectedMd5(block, 201));
        // 成功路径同样不留临时文件（201MiB 落盘再上传，最后必须删干净）
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("超过调用方上限即拒（错误信息带 MB 值），不上传、不留临时文件")
    void persistStreaming_rejectsResultOverCallerCap() throws Exception {
        // 2MiB 成品对 1MiB 上限：超限判定发生在落盘途中，不是读完才判
        String url = serve("video/mp4", 200, 2L * 1024 * 1024, patternBlock());
        TOSV2 client = mock(TOSV2.class);
        List<String> tempBefore = relayTempFiles();

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", 1024 * 1024))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("超过转存上限")
                .hasMessageContaining("1MB");

        verify(client, never()).putObject(any(PutObjectInput.class));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("非视频 mime 即拒（转存前校验，不落盘不上传）")
    void persistStreaming_rejectsNonVideoMime() throws Exception {
        String url = serve("image/png", 200, 128, patternBlock());
        TOSV2 client = mock(TOSV2.class);

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("生成结果不是视频");

        verify(client, never()).putObject(any(PutObjectInput.class));
    }

    @Test
    @DisplayName("空内容即拒（0 字节成品不建对象）")
    void persistStreaming_rejectsEmptyBody() throws Exception {
        // -1 = 无响应体（Content-Length 缺席），客户端读到 EOF 即 0 字节
        String url = serve("video/mp4", 200, -1, patternBlock());
        TOSV2 client = mock(TOSV2.class);

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("生成视频为空");

        verify(client, never()).putObject(any(PutObjectInput.class));
    }

    @Test
    @DisplayName("HTTP 非 2xx → 下载失败错误带状态码与 body 片段，不上传")
    void persistStreaming_rejectsHttpError() throws Exception {
        String url = serve("video/webm", 404, 0, patternBlock());
        TOSV2 client = mock(TOSV2.class);

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("生成视频下载失败: HTTP 404")
                .hasMessageContaining("not found");

        verify(client, never()).putObject(any(PutObjectInput.class));
    }

    @Test
    @DisplayName("成功路径：key/扩展名/Content-Type/ACL 与字节数组路径同款，md5 与整段算法逐字节相等")
    void persistStreaming_successMatchesByteArrayPath() throws Exception {
        byte[] payload = new byte[4096];
        System.arraycopy(patternBlock(), 0, payload, 0, payload.length);
        String url = serve("video/quicktime; charset=binary", 200, payload.length, payload);
        TOSV2 client = mock(TOSV2.class);
        AtomicLong uploadedBytes = new AtomicLong();
        List<PutObjectInput> uploads = captureUploads(client, uploadedBytes);

        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES);

        // quicktime → .mov（videoExtension 同款）；mime 去参数后落库
        assertThat(stored.mime()).isEqualTo("video/quicktime");
        assertThat(stored.storageKey()).startsWith("generated/9/video/").endsWith(".mov");
        assertThat(stored.url()).isEqualTo("https://bkt.tos.example.com/" + stored.storageKey());
        assertThat(uploadedBytes.get()).isEqualTo(payload.length);
        assertThat(uploads.get(0).getBucket()).isEqualTo("bkt");
        assertThat(uploads.get(0).getOptions().getHeaders())
                .containsEntry("Content-Type", "video/quicktime");
        // 分块算的 md5 必须与整段算的相等——否则上传件与生成件命不中 assets.md5 去重
        assertThat(stored.md5()).isEqualTo(ContentDigest.md5Hex(payload));

        var aclCaptor = org.mockito.ArgumentCaptor.forClass(PutObjectACLInput.class);
        verify(client).putObjectAcl(aclCaptor.capture());
        assertThat(aclCaptor.getValue().getAcl()).isEqualTo(ACLType.ACL_PUBLIC_READ);
        assertThat(aclCaptor.getValue().getKey()).isEqualTo(stored.storageKey());
    }

    // ========== IKHSFC：停流主动中止（截止时间只在 read 返回后检查 → 停流挂死） ==========

    @Test
    @DisplayName("成功响应停流（头已到、正文停发、连接保持）→ 截止时间到主动中止读取，不等对端发数据或断连")
    @Timeout(30)
    void persistStreaming_stalledBody_abortsAtDeadline() throws Exception {
        String url = serveStalled("video/webm", 200, 8L * 1024 * 1024, 64 * 1024);
        TOSV2 client = mock(TOSV2.class);
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, Duration.ofMillis(200), Duration.ofSeconds(5)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("下载超时");

        // 及时性即证明：中止是主动触发（deadline 200ms），不是等对端超时/断连
        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        verify(client, never()).putObject(any(PutObjectInput.class));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("错误响应正文停流（500 头已到、正文零字节不发）→ 受有效截止约束主动退出，不留后台读取")
    @Timeout(30)
    void persistStreaming_stalledErrorBody_abortsAtDeadline() throws Exception {
        String url = serveStalled("video/webm", 500, 4096, 0);
        TOSV2 client = mock(TOSV2.class);
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, Duration.ofMinutes(10), Duration.ofMillis(200)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("错误响应正文");

        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        verify(client, never()).putObject(any(PutObjectInput.class));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("外部中止句柄触发（租约丢失先例）→ 停流传输立即中止为 TransferAbortedException，原因透传")
    @Timeout(30)
    void persistStreaming_externalAbort_stopsStalledTransfer() throws Exception {
        String url = serveStalled("video/webm", 200, 8L * 1024 * 1024, 64 * 1024);
        TOSV2 client = mock(TOSV2.class);
        TosVideoMediaRelay.TransferAbortHandle handle = new TosVideoMediaRelay.TransferAbortHandle();
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();
        Thread aborter = new Thread(() -> {
            try {
                Thread.sleep(200);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            handle.abort("结果转存租约丢失");
        });
        aborter.start();

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        handle, Duration.ofMinutes(10), Duration.ofSeconds(5)))
                .isInstanceOf(TosVideoMediaRelay.TransferAbortedException.class)
                .hasMessageContaining("结果转存租约丢失");

        aborter.join(5_000);
        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        verify(client, never()).putObject(any(PutObjectInput.class));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("上传期间外部中止（IKHSFD）：guarding 流 read 被拦截 → putObject 失败归并为 TransferAbortedException，不做 ACL")
    @Timeout(30)
    void persistStreaming_externalAbort_duringUpload_stopsUpload() throws Exception {
        // 下载正常完成（4KiB 正常发完），中止发生在上传途中
        byte[] payload = new byte[4096];
        System.arraycopy(patternBlock(), 0, payload, 0, payload.length);
        String url = serve("video/mp4", 200, payload.length, payload);
        TOSV2 client = mock(TOSV2.class);
        TosVideoMediaRelay.TransferAbortHandle handle = new TosVideoMediaRelay.TransferAbortHandle();
        List<String> tempBefore = relayTempFiles();
        doAnswer(invocation -> {
            PutObjectInput input = invocation.getArgument(0);
            try (InputStream in = input.getContent()) {
                byte[] buf = new byte[1024];
                if (in.read(buf) <= 0) {
                    throw new IOException("首读失败");
                }
                // 模拟上传途中失去所有权：心跳触发中止
                handle.abort("结果转存期租约未命中（已被接管/终态）");
                while (in.read(buf) != -1) {
                    // guarding 包装流应在此抛 IOException，读不到 EOF
                }
                throw new IllegalStateException("中止后上传流仍可读完（guarding 未拦截）");
            }
        }).when(client).putObject(any(PutObjectInput.class));

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES, handle))
                .isInstanceOf(TosVideoMediaRelay.TransferAbortedException.class)
                .hasMessageContaining("租约未命中");

        verify(client, never()).putObjectAcl(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("中止句柄传入但未触发 → 成功路径不受影响（接线不误伤）")
    void persistStreaming_unusedAbortHandle_doesNotDisturbSuccess() throws Exception {
        byte[] payload = new byte[4096];
        System.arraycopy(patternBlock(), 0, payload, 0, payload.length);
        String url = serve("video/mp4", 200, payload.length, payload);
        TOSV2 client = mock(TOSV2.class);
        AtomicLong uploadedBytes = new AtomicLong();
        captureUploads(client, uploadedBytes);

        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        new TosVideoMediaRelay.TransferAbortHandle());

        assertThat(stored.size()).isEqualTo(payload.length);
        assertThat(uploadedBytes.get()).isEqualTo(payload.length);
    }
}
