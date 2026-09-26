package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.model.object.PreSignedURLInput;
import com.volcengine.tos.model.object.PreSignedURLOutput;
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
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
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
 * 桩服务用 JDK 自带 HttpServer（网关客户端测试同款），签名用 mock，上传/下载走本地 HTTP/TCP——不连接真实供应商。
 */
class TosVideoMediaRelayTest {

    /** 桩服务块大小 1MiB：body 由同一个块重复而成，测试侧不占大内存。 */
    private static final int BLOCK_BYTES = 1024 * 1024;

    private HttpServer server;
    private HttpServer uploadServer;
    private volatile String uploadedMd5;
    private volatile String uploadedMime;
    private volatile String uploadedAcl;
    private final java.util.concurrent.CountDownLatch releaseStall = new java.util.concurrent.CountDownLatch(1);

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
                releaseStall.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/out.bin";
    }

    /**
     * 受控慢速源桩（IKILVH）：块间 sleep 控制持续吞吐——连接持续有进度但速率受限，模拟
     * 「合法慢传输」（与停流桩相对：不是不吐数据，只是吐得慢）。真实 HTTP/TCP 流式读写。
     */
    private String serveSlow(String contentType, int blockBytes, int blockCount, long blockDelayMs)
            throws IOException {
        byte[] block = patternBlock();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(200, (long) blockBytes * blockCount);
            try (OutputStream out = exchange.getResponseBody()) {
                for (int i = 0; i < blockCount; i++) {
                    out.write(block, 0, blockBytes);
                    out.flush();
                    Thread.sleep(blockDelayMs);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/out.bin";
    }

    /**
     * 停顿后恢复桩（IKIN01）：响应头 + 首块（64KiB，超内核 socket 缓冲必已送达）后静默
     * {@code pauseMs} 再发完剩余——模拟四参旧口径下合法的「正文短暂停顿后恢复」，与无限
     * 挂住的停流桩相对：停顿有界且总时长可预知，用于判别「停顿窗口内不杀 + 固定窗到点才杀」。
     */
    private String servePauseThenResume(String contentType, int firstBytes, long pauseMs, long totalBytes)
            throws IOException {
        byte[] block = patternBlock();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(200, totalBytes);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(block, 0, firstBytes);
                out.flush();
                Thread.sleep(pauseMs);
                long remaining = totalBytes - firstBytes;
                while (remaining > 0) {
                    int chunk = (int) Math.min(block.length, remaining);
                    out.write(block, 0, chunk);
                    remaining -= chunk;
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/out.bin";
    }

    /** 仅替代 SDK 本地签名；上传走真实 HTTP 流，服务端校验实际收到的字节和元数据。 */
    private List<PreSignedURLInput> captureUploads(TOSV2 client, AtomicLong uploadedBytes) throws IOException {
        List<PreSignedURLInput> uploads = new ArrayList<>();
        uploadServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        uploadServer.createContext("/", exchange -> {
            try (InputStream in = exchange.getRequestBody()) {
                MessageDigest digest;
                try { digest = MessageDigest.getInstance("MD5"); }
                catch (java.security.NoSuchAlgorithmException e) { throw new IOException(e); }
                byte[] buffer = new byte[64 * 1024];
                long total = 0;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    total += read;
                    digest.update(buffer, 0, read);
                }
                uploadedBytes.set(total);
                uploadedMd5 = HexFormat.of().formatHex(digest.digest());
                uploadedMime = exchange.getRequestHeaders().getFirst("Content-Type");
                uploadedAcl = exchange.getRequestHeaders().getFirst("x-tos-acl");
                exchange.sendResponseHeaders(200, -1);
            } finally {
                exchange.close();
            }
        });
        uploadServer.start();
        doAnswer(invocation -> {
            PreSignedURLInput input = invocation.getArgument(0);
            uploads.add(input);
            return new PreSignedURLOutput("http://127.0.0.1:" + uploadServer.getAddress().getPort()
                    + "/" + input.getKey(), input.getHeader());
        }).when(client).preSignedURL(any(PreSignedURLInput.class));
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
        releaseStall.countDown();
        if (uploadServer != null) uploadServer.stop(0);
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
        List<PreSignedURLInput> uploads = captureUploads(client, uploadedBytes);
        List<String> tempBefore = relayTempFiles();

        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES);

        // 前提钉死：这段成品确实超过家族上限，且抠像口径容得下
        assertThat(payloadBytes).isGreaterThan(TosVideoMediaRelay.MAX_VIDEO_BYTES);
        assertThat(VideoMattingContract.MAX_RESULT_BYTES).isGreaterThan(payloadBytes);
        assertThat(stored.size()).isEqualTo(payloadBytes);
        assertThat(uploadedBytes.get()).isEqualTo(payloadBytes);
        assertThat(uploads).hasSize(1);
        assertThat(uploadedMd5).isEqualTo(expectedMd5(block, 201));
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
        List<PreSignedURLInput> uploads = captureUploads(client, uploadedBytes);

        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES);

        // quicktime → .mov（videoExtension 同款）；mime 去参数后落库
        assertThat(stored.mime()).isEqualTo("video/quicktime");
        assertThat(stored.storageKey()).startsWith("generated/9/video/").endsWith(".mov");
        assertThat(stored.url()).isEqualTo("https://bkt.tos.example.com/" + stored.storageKey());
        assertThat(uploadedBytes.get()).isEqualTo(payload.length);
        assertThat(uploads.get(0).getBucket()).isEqualTo("bkt");
        assertThat(uploads.get(0).getHeader())
                .containsEntry("Content-Type", "video/quicktime");
        // 分块算的 md5 必须与整段算的相等——否则上传件与生成件命不中 assets.md5 去重
        assertThat(stored.md5()).isEqualTo(ContentDigest.md5Hex(payload));

        assertThat(uploadedAcl).isEqualTo("public-read");
        assertThat(uploadedMime).isEqualTo("video/quicktime");
        assertThat(uploadedMd5).isEqualTo(ContentDigest.md5Hex(payload));
        assertThat(uploads.get(0).getHeader()).containsEntry("x-tos-acl", "public-read");
        verify(client, never()).putObjectAcl(any());
    }

    // ========== IKHSFC：停流主动中止（截止时间只在 read 返回后检查 → 停流挂死） ==========

    @Test
    @DisplayName("成功响应停流（头已到、正文停发、连接保持）→ 停流超时到点主动中止读取，不等对端发数据或断连")
    @Timeout(30)
    void persistStreaming_stalledBody_abortsAtStallTimeout() throws Exception {
        String url = serveStalled("video/webm", 200, 8L * 1024 * 1024, 64 * 1024);
        TOSV2 client = mock(TOSV2.class);
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, null, null, Duration.ofMillis(200), Duration.ofSeconds(5)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("下载停流")
                .hasMessageContaining("无进度");

        // 及时性即证明：中止是主动触发（停流 200ms 即止），不是等对端超时/断连
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
                        null, null, null, Duration.ofMinutes(10), Duration.ofMillis(200)))
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
                        handle, null, null, Duration.ofMinutes(10), Duration.ofSeconds(5)))
                .isInstanceOf(TosVideoMediaRelay.TransferAbortedException.class)
                .hasMessageContaining("结果转存租约丢失");

        aborter.join(5_000);
        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(5));
        // 下载阶段中止：PUT 未发起，无对象可清理
        verify(client, never()).putObject(any(PutObjectInput.class));
        verify(client, never()).deleteObject(any());
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @Timeout(15)
    @DisplayName("上传正文发完后等待响应：失租主动断开上传连接，不依赖下一次文件读取")
    void externalAbort_disconnectsUploadWaitingForResponse() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        var handle = new TosVideoMediaRelay.TransferAbortHandle();
        var received = new java.util.concurrent.CountDownLatch(1);
        List<String> before = relayTempFiles();
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            org.mockito.Mockito.when(client.preSignedURL(any(com.volcengine.tos.model.object.PreSignedURLInput.class)))
                    .thenReturn(new com.volcengine.tos.model.object.PreSignedURLOutput(
                            "http://127.0.0.1:" + socketServer.getLocalPort() + "/upload", java.util.Map.of()));
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(5000);
                    InputStream in = socket.getInputStream();
                    var header = new java.io.ByteArrayOutputStream();
                    int next;
                    while ((next = in.read()) != -1) {
                        header.write(next);
                        if (header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
                    }
                    String headers = header.toString(StandardCharsets.US_ASCII);
                    assertThat(headers.toLowerCase()).contains("content-length: 4096");
                    assertThat(in.readNBytes(4096)).hasSize(4096);
                    received.countDown();
                    // 服务端保持连接且不发响应；取消必须真正关闭客户端 socket。
                    return in.read();
                }
            });
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES, handle));
            try {
                assertThat(received.await(5, java.util.concurrent.TimeUnit.SECONDS))
                        .as("流式上传必须到达真实 HTTP 传输层").isTrue();
                handle.abort("lease lost");
                assertThatThrownBy(() -> transfer.get(2, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class)
                        .hasCauseInstanceOf(TosVideoMediaRelay.TransferAbortedException.class);
                assertThat(peer.get(2, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(-1);
                assertThat(relayTempFiles()).isEqualTo(before);
                verify(client, never()).putObjectAcl(any());
                // IKILVH：PUT 已发起且 body 已完整送达（对象可能已在上游落地成无 Asset 引用
                // 的孤儿）→ 中止退出前必须 deleteObject 清理未发布对象
                var deleted = org.mockito.ArgumentCaptor.forClass(
                        com.volcengine.tos.model.object.DeleteObjectInput.class);
                verify(client).deleteObject(deleted.capture());
                assertThat(deleted.getValue().getBucket()).isEqualTo("bkt");
                assertThat(deleted.getValue().getKey()).startsWith("generated/9/video/");
            } finally {
                handle.abort("test cleanup");
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }

    // ========== IKILVH：总时限除名——停流超时 + 任务截止时间 + 容量上限三限界 ==========

    /**
     * 缩比模型说明（IKILVH）：注入的 stallTimeout（500ms）正是旧 {@code copyDeadline} 参数位
     * ——若实现仍按「总时限」语义，本用例总时长 ~1.2s > 500ms 必失败；按「停流超时」语义
     * （块间隔 100ms < 500ms，持续有进度）必完成。同一注入参数的两种语义由本用例判别。
     * <p>
     * 受控吞吐与时长记录：慢流桩 64KiB/100ms ≈ 0.6MiB/s 持续吞吐，总转存时长 ~1.2s（>
     * 2× 停流超时缩比值）；对应真实参数（60s 停流 / 10GiB 上限）线上能否完成取决于实际
     * 吞吐与任务截止时间（10GiB@2MiB/s ≈ 85 分钟），本测试不宣称线上任意速率均可完成。
     */
    @Test
    @Timeout(30)
    @DisplayName("受控慢流持续有进度：总时长超过注入时限 2 倍仍完成转存（固定总时限已除名，停流超时才计时）")
    void persistStreaming_slowStreamWithProgress_completesPastLegacyTotalDeadline() throws Exception {
        int blocks = 12;
        int blockBytes = 64 * 1024;
        String url = serveSlow("video/webm", blockBytes, blocks, 100);
        TOSV2 client = mock(TOSV2.class);
        AtomicLong uploadedBytes = new AtomicLong();
        captureUploads(client, uploadedBytes);
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, null, null, Duration.ofMillis(500), Duration.ofSeconds(5));

        long elapsedMs = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
        // 前提钉死：传输确实持续了 ~1.2s（真慢流），且超过注入时限（500ms）2 倍——旧总时限
        // 语义下此传输必被中止；停流语义下块间隔 100ms 持续重置基准，全程无中止
        // 慢流块是 patternBlock 的前 blockBytes 切片（桩按块截断发送），期望 md5 按同切片重复
        byte[] slice = java.util.Arrays.copyOf(patternBlock(), blockBytes);
        assertThat(elapsedMs).isGreaterThan(1_000);
        assertThat(stored.size()).isEqualTo((long) blockBytes * blocks);
        assertThat(uploadedBytes.get()).isEqualTo((long) blockBytes * blocks);
        assertThat(stored.md5()).isEqualTo(expectedMd5(slice, blocks));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
        verify(client, never()).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
    }

    @Test
    @Timeout(30)
    @DisplayName("任务截止时间到点（execution_deadline_at）→ 主动中止慢流传输，文案与停流/超限/中止分别命名")
    void persistStreaming_taskDeadline_abortsSlowTransfer() throws Exception {
        String url = serveSlow("video/mp4", 64 * 1024, 12, 100);
        TOSV2 client = mock(TOSV2.class);
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();
        // 停流超时给足（慢流持续有进度本就不会触发），确保中止只能来自任务截止
        java.time.Instant deadline = java.time.Instant.now().plusMillis(300);

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, deadline, null, Duration.ofMinutes(10), Duration.ofSeconds(5)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("任务执行截止时间已到");

        // 及时性即证明：截止 300ms 即止，不是等 1.2s 慢流自然结束，也不是 10 分钟停流超时
        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(3));
        verify(client, never()).putObject(any(PutObjectInput.class));
        verify(client, never()).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("真实 SDK 签名覆盖上传元数据，实际上传失败不得返回成功且清理临时文件")
    void signedUpload_rejectsServerFailure() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        uploadServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var query = new java.util.concurrent.atomic.AtomicReference<String>();
        uploadServer.createContext("/", exchange -> {
            exchange.getRequestBody().transferTo(OutputStream.nullOutputStream());
            query.set(exchange.getRequestURI().getRawQuery());
            uploadedAcl = exchange.getRequestHeaders().getFirst("x-tos-acl");
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        uploadServer.start();
        var config = com.volcengine.tos.TOSClientConfiguration.builder()
                .region("cn-beijing").endpoint("http://127.0.0.1:" + uploadServer.getAddress().getPort())
                .credentials(new com.volcengine.tos.auth.StaticCredentials("test-ak", "test-sk"))
                .build().setCustomDomain(true);
        List<String> before = relayTempFiles();
        try (TOSV2 client = new com.volcengine.tos.TOSV2ClientBuilder().build(config)) {
            assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES))
                    .isInstanceOf(VideoProviderError.class).hasMessageContaining("HTTP 503");
        }
        assertThat(java.net.URLDecoder.decode(query.get(), StandardCharsets.UTF_8))
                .contains("X-Tos-SignedHeaders=content-type;host;x-tos-acl");
        assertThat(uploadedAcl).isEqualTo("public-read");
        assertThat(relayTempFiles()).isEqualTo(before);
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

    // ========== IKIN01：四参兼容入口恢复 IKILVH 前旧口径（下载段 10 分钟固定窗，无停流，上传段无截止） ==========

    /**
     * 四参兜底的验证方式（IKIN01 修订）：不真等 10 分钟——spy 打桩 {@code persistStreamingInternal}
     * 捕获四参入口注入的时限参数，钉住「下载正文段 10 分钟固定窗（copyWindow）+ 不布防停流 +
     * 不布防任务截止」的形态；各时限的行为语义（窗到点中止、停流不杀四参、上传段无截止）由
     * 本节行为用例分别钉死，两段组合即四参兼容口径的完整证明。
     */
    @Test
    @DisplayName("四参入口注入下载段 10 分钟固定窗兜底：不布防停流、不布防任务截止（旧口径形态）")
    void persistStreaming_fourArgs_fallsBackToLegacyTotalDeadline() {
        TosVideoMediaRelay relay = spy(new TosVideoMediaRelay(mock(TOSV2.class), "bkt", "tos.example.com"));
        doReturn(new TosVideoMediaRelay.StoredVideo("u", "k", "video/mp4", 1L, "d"))
                .when(relay).persistStreamingInternal(any(), any(), anyLong(),
                        any(), any(), any(), any(), any());

        relay.persistStreaming("https://volc/out.mp4", "9", 1024, null);

        var taskDeadline = org.mockito.ArgumentCaptor.forClass(java.time.Instant.class);
        var copyWindow = org.mockito.ArgumentCaptor.forClass(Duration.class);
        var stallTimeout = org.mockito.ArgumentCaptor.forClass(Duration.class);
        verify(relay).persistStreamingInternal(eq("https://volc/out.mp4"), eq("9"), eq(1024L),
                isNull(), taskDeadline.capture(), copyWindow.capture(),
                stallTimeout.capture(), any());
        // 四参旧口径：任务截止不受限（不进 armDeadline 全程布防）、停流不受限（60s 停流只属五参）
        assertThat(taskDeadline.getValue()).isNull();
        assertThat(stallTimeout.getValue()).isNull();
        // 兜底 = 下载正文段固定总窗 10 分钟（STREAM_COPY_DEADLINE，进度不重置）
        assertThat(copyWindow.getValue()).isEqualTo(Duration.ofMinutes(10));
    }

    @Test
    @DisplayName("五参入口透传调用方任务截止：null 不强加 10 分钟兜底、具体值原样透传")
    void persistStreaming_fiveArgs_passesThroughCallerDeadline() {
        TosVideoMediaRelay relay = spy(new TosVideoMediaRelay(mock(TOSV2.class), "bkt", "tos.example.com"));
        doReturn(new TosVideoMediaRelay.StoredVideo("u", "k", "video/mp4", 1L, "d"))
                .when(relay).persistStreamingInternal(any(), any(), anyLong(),
                        any(), any(), any(), any(), any());

        // AudioVideoMux 无 execution_deadline_at 时传 null：不得强加 10 分钟兜底（慢流不受总时限）
        relay.persistStreaming("https://volc/out.mp4", "9", 1024, null, null);
        verify(relay).persistStreamingInternal(eq("https://volc/out.mp4"), eq("9"), eq(1024L),
                isNull(), isNull(), isNull(), any(), any());

        java.time.Instant callerDeadline = java.time.Instant.now().plusSeconds(7);
        relay.persistStreaming("https://volc/out.mp4", "9", 1024, null, callerDeadline);
        verify(relay).persistStreamingInternal(eq("https://volc/out.mp4"), eq("9"), eq(1024L),
                isNull(), same(callerDeadline), isNull(), any(), any());
    }

    /**
     * 四参形态的注入方式（IKIN01）：直调包级 internal，把 10 分钟窗缩比为亚秒级 copyWindow，
     * stallTimeout / taskDeadline 传 null——正是四参公开入口注入的形态（上一用例钉死）。本用例
     * 钉「正文短暂停顿后恢复，在旧总时限内完成」：停顿 700ms 若被误布防 60s 停流（或任何进度
     * 基准重置模型之外的杀流规则）不可能出现在 null 语义下；窗 2s 容得下停顿 + 传输。
     */
    @Test
    @Timeout(15)
    @DisplayName("四参口径：正文短暂停顿后在旧总时限内恢复可完成（停流规则不适用于本入口）")
    void persistStreaming_fourArgs_bodyPauseWithinCopyWindow_completes() throws Exception {
        int blockBytes = 64 * 1024;
        String url = servePauseThenResume("video/webm", blockBytes, 700, (long) blockBytes * 2);
        TOSV2 client = mock(TOSV2.class);
        AtomicLong uploadedBytes = new AtomicLong();
        captureUploads(client, uploadedBytes);
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        TosVideoMediaRelay.StoredVideo stored = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, null, Duration.ofSeconds(2), null, Duration.ofSeconds(5));

        long elapsedMs = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
        byte[] slice = java.util.Arrays.copyOf(patternBlock(), blockBytes);
        // 停顿真实发生（桩在服务端 sleep 700ms）且没有触发任何中止
        assertThat(elapsedMs).isGreaterThan(600);
        assertThat(stored.size()).isEqualTo((long) blockBytes * 2);
        assertThat(uploadedBytes.get()).isEqualTo((long) blockBytes * 2);
        assertThat(stored.md5()).isEqualTo(expectedMd5(slice, 2));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
        verify(client, never()).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
    }

    /**
     * 固定窗 vs 停流的语义判别（IKIN01）：同一慢流（持续有进度、总时长 ~1.2s）在 copyWindow
     * 500ms 下必须失败——窗是固定总窗（从正文开始读取起算、进度不重置），与五参停流模型
     * （块间隔 100ms 持续重置基准、总时长不限）互斥。若四参被误接停流语义，本用例会完成而红。
     */
    @Test
    @Timeout(15)
    @DisplayName("四参口径：正文真正超时（慢流总时长超过固定窗）即失败，文案独立命名")
    void persistStreaming_fourArgs_fixedCopyWindow_failsWhenExceeded() throws Exception {
        String url = serveSlow("video/mp4", 64 * 1024, 12, 100);
        TOSV2 client = mock(TOSV2.class);
        List<String> tempBefore = relayTempFiles();
        long startNanos = System.nanoTime();

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, null, Duration.ofMillis(500), null, Duration.ofSeconds(5)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("生成视频下载超时")
                .hasMessageContaining("500ms");

        // 及时性即证明：500ms 窗到点主动中止，不是等 1.2s 慢流自然结束
        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(3));
        verify(client, never()).putObject(any(PutObjectInput.class));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    /**
     * 上传段不受四参兜底窗约束（IKIN01）：下载在缩比窗（300ms）内完成后，上传服务端收完
     * body 延迟 1.5s 才回响应——窗早已过期但上传段必须照常完成（旧口径：固定窗只管下载
     * 正文段，正文结束即撤销）。若窗被误接任务截止语义（armDeadline 全程布防），过期即
     * cancel 上传连接，本用例会以「任务执行截止时间已到」失败而红。
     */
    @Test
    @Timeout(15)
    @DisplayName("四参口径：下载完成后的慢上传可完成（兜底窗不约束上传段）")
    void persistStreaming_fourArgs_slowUploadAfterCopyWindow_completes() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        List<String> before = relayTempFiles();
        var received = new java.util.concurrent.CountDownLatch(1);
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            org.mockito.Mockito.when(client.preSignedURL(any(com.volcengine.tos.model.object.PreSignedURLInput.class)))
                    .thenReturn(new com.volcengine.tos.model.object.PreSignedURLOutput(
                            "http://127.0.0.1:" + socketServer.getLocalPort() + "/upload", java.util.Map.of()));
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(5000);
                    InputStream in = socket.getInputStream();
                    var header = new java.io.ByteArrayOutputStream();
                    int next;
                    while ((next = in.read()) != -1) {
                        header.write(next);
                        if (header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
                    }
                    assertThat(in.readNBytes(4096)).hasSize(4096);
                    received.countDown();
                    // 收完 body 后延迟 1.5s 才回 200：copyWindow 300ms 早已过期，上传必须不受其约束
                    Thread.sleep(1500);
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"
                            .getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().flush();
                    return 0;
                }
            });
            TosVideoMediaRelay.StoredVideo stored;
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreamingInternal(source, "9", VideoMattingContract.MAX_RESULT_BYTES,
                            null, null, Duration.ofMillis(300), null, Duration.ofSeconds(5)));
            try {
                assertThat(received.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                stored = transfer.get(8, java.util.concurrent.TimeUnit.SECONDS);
            } finally {
                socketServer.close();
                transfer.cancel(true);
            }
            assertThat(stored.size()).isEqualTo(4096L);
            assertThat(relayTempFiles()).isEqualTo(before);
            verify(client, never()).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
        }
    }

    /**
     * 上传段截止归因（IKILU5）：下载快速完成后上传 body 送达服务端、连接挂住等响应——此窗口
     * 任务截止到点只能靠看门狗 cancel 上传请求，抛出的 IOException 若不先做截止归因会被
     * 误包成「生成视频转存网络失败」。截止中止是普通失败口径（与外部中止的静默退出不同），
     * PUT 已发起的未发布对象清理与下载段截止口径一致（不清理，由既有用例断言）。
     */
    @Test
    @Timeout(15)
    @DisplayName("上传段任务截止到点：中止归因为「任务执行截止时间已到」，不误报网络失败")
    void taskDeadlineDuringUpload_reportsDeadlineNotNetworkFailure() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        List<String> before = relayTempFiles();
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            org.mockito.Mockito.when(client.preSignedURL(any(com.volcengine.tos.model.object.PreSignedURLInput.class)))
                    .thenReturn(new com.volcengine.tos.model.object.PreSignedURLOutput(
                            "http://127.0.0.1:" + socketServer.getLocalPort() + "/upload", java.util.Map.of()));
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(5000);
                    InputStream in = socket.getInputStream();
                    var header = new java.io.ByteArrayOutputStream();
                    int next;
                    while ((next = in.read()) != -1) {
                        header.write(next);
                        if (header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
                    }
                    assertThat(in.readNBytes(4096)).hasSize(4096);
                    // 服务端收完 body 挂住不回响应：上传停在等响应窗口，截止只能靠看门狗取消连接
                    return in.read();
                }
            });
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES,
                            null, java.time.Instant.now().plusMillis(500)));
            try {
                assertThatThrownBy(() -> transfer.get(5, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class)
                        .hasCauseInstanceOf(VideoProviderError.class)
                        .hasMessageContaining("任务执行截止时间已到")
                        .hasMessageNotContaining("转存网络失败");
                // 截止取消连接后服务端读到 EOF；截止是普通失败口径，不做未发布对象清理（同下载段）
                assertThat(peer.get(2, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(-1);
                assertThat(relayTempFiles()).isEqualTo(before);
                verify(client, never()).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
            } finally {
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }
}
