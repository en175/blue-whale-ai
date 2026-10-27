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
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.CompletableFuture;
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
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;

class TosVideoMediaRelayTest {

    private static final int BLOCK_BYTES = 1024 * 1024;

    private HttpServer server;
    private HttpServer uploadServer;
    private volatile String uploadedMd5;
    private volatile String uploadedMime;
    private volatile String uploadedAcl;
    private final java.util.concurrent.CountDownLatch releaseStall = new java.util.concurrent.CountDownLatch(1);
    private final java.util.concurrent.ConcurrentHashMap<String, byte[]> tosObjects =
            new java.util.concurrent.ConcurrentHashMap<>();

    private static byte[] patternBlock() {
        byte[] block = new byte[BLOCK_BYTES];
        for (int i = 0; i < BLOCK_BYTES; i++) {
            block[i] = (byte) (i % 251);
        }
        return block;
    }

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

    private void deleteObjectsFromState(TOSV2 client) {
        doAnswer(invocation -> {
            com.volcengine.tos.model.object.DeleteObjectInput input = invocation.getArgument(0);
            tosObjects.remove(input.getKey());
            return null;
        }).when(client).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
    }

    private void stubPresignedUrlToSocket(TOSV2 client, java.net.ServerSocket socketServer) {
        doAnswer(invocation -> {
            PreSignedURLInput input = invocation.getArgument(0);
            return new PreSignedURLOutput(
                    "http://127.0.0.1:" + socketServer.getLocalPort() + "/" + input.getKey(),
                    java.util.Map.of());
        }).when(client).preSignedURL(any(PreSignedURLInput.class));
    }

    private record SocketPut(String key, byte[] body) {}

    private static SocketPut readPut(java.net.Socket socket, int bodyBytes) throws IOException {
        InputStream in = socket.getInputStream();
        var header = new java.io.ByteArrayOutputStream();
        int next;
        while ((next = in.read()) != -1) {
            header.write(next);
            if (header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
        }
        String requestLine = header.toString(StandardCharsets.US_ASCII).split("\r\n", 2)[0];
        String key = requestLine.split(" ")[1].substring(1);
        byte[] body = in.readNBytes(bodyBytes);
        return new SocketPut(key, body);
    }

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

        assertThat(payloadBytes).isGreaterThan(TosVideoMediaRelay.MAX_VIDEO_BYTES);
        assertThat(VideoMattingContract.MAX_RESULT_BYTES).isGreaterThan(payloadBytes);
        assertThat(stored.size()).isEqualTo(payloadBytes);
        assertThat(uploadedBytes.get()).isEqualTo(payloadBytes);
        assertThat(uploads).hasSize(1);
        assertThat(uploadedMd5).isEqualTo(expectedMd5(block, 201));
        assertThat(uploads.get(0).getKey()).startsWith("generated/9/video/").endsWith(".webm");
        assertThat(stored.md5()).isEqualTo(expectedMd5(block, 201));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

    @Test
    @DisplayName("超过调用方上限即拒（错误信息带 MB 值），不上传、不留临时文件")
    void persistStreaming_rejectsResultOverCallerCap() throws Exception {
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

        assertThat(stored.mime()).isEqualTo("video/quicktime");
        assertThat(stored.storageKey()).startsWith("generated/9/video/").endsWith(".mov");
        assertThat(stored.url()).isEqualTo("https://bkt.tos.example.com/" + stored.storageKey());
        assertThat(uploadedBytes.get()).isEqualTo(payload.length);
        assertThat(uploads.get(0).getBucket()).isEqualTo("bkt");
        assertThat(uploads.get(0).getHeader())
                .containsEntry("Content-Type", "video/quicktime");
        assertThat(stored.md5()).isEqualTo(ContentDigest.md5Hex(payload));

        assertThat(uploadedAcl).isEqualTo("public-read");
        assertThat(uploadedMime).isEqualTo("video/quicktime");
        assertThat(uploadedMd5).isEqualTo(ContentDigest.md5Hex(payload));
        assertThat(uploads.get(0).getHeader()).containsEntry("x-tos-acl", "public-read");
        verify(client, never()).putObjectAcl(any());
    }


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
        java.time.LocalDateTime deadline = java.time.LocalDateTime.now().plusNanos(300_000_000);

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreamingInternal(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                        null, deadline, null, Duration.ofMinutes(10), Duration.ofSeconds(5)))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining(TosVideoMediaRelay.TASK_DEADLINE_ABORT_MESSAGE);

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


    @Test
    @DisplayName("四参入口注入下载段 10 分钟固定窗兜底：不布防停流、不布防任务截止（旧口径形态）")
    void persistStreaming_fourArgs_fallsBackToLegacyTotalDeadline() {
        TosVideoMediaRelay relay = spy(new TosVideoMediaRelay(mock(TOSV2.class), "bkt", "tos.example.com"));
        doReturn(new TosVideoMediaRelay.StoredVideo("u", "k", "video/mp4", 1L, "d"))
                .when(relay).persistStreamingInternal(any(), any(), anyLong(),
                        any(), any(), any(), any(), any());

        relay.persistStreaming("https://volc/out.mp4", "9", 1024, null);

        var taskDeadline = org.mockito.ArgumentCaptor.forClass(java.time.LocalDateTime.class);
        var copyWindow = org.mockito.ArgumentCaptor.forClass(Duration.class);
        var stallTimeout = org.mockito.ArgumentCaptor.forClass(Duration.class);
        verify(relay).persistStreamingInternal(eq("https://volc/out.mp4"), eq("9"), eq(1024L),
                isNull(), taskDeadline.capture(), copyWindow.capture(),
                stallTimeout.capture(), any());
        assertThat(taskDeadline.getValue()).isNull();
        assertThat(stallTimeout.getValue()).isNull();
        assertThat(copyWindow.getValue()).isEqualTo(Duration.ofMinutes(10));
    }

    @Test
    @DisplayName("五参入口透传调用方任务截止：null 不强加 10 分钟兜底、具体值原样透传")
    void persistStreaming_fiveArgs_passesThroughCallerDeadline() {
        TosVideoMediaRelay relay = spy(new TosVideoMediaRelay(mock(TOSV2.class), "bkt", "tos.example.com"));
        doReturn(new TosVideoMediaRelay.StoredVideo("u", "k", "video/mp4", 1L, "d"))
                .when(relay).persistStreamingInternal(any(), any(), anyLong(),
                        any(), any(), any(), any(), any());

        relay.persistStreaming("https://volc/out.mp4", "9", 1024, null, null);
        verify(relay).persistStreamingInternal(eq("https://volc/out.mp4"), eq("9"), eq(1024L),
                isNull(), isNull(), isNull(), any(), any());

        java.time.LocalDateTime callerDeadline = java.time.LocalDateTime.now().plusSeconds(7);
        relay.persistStreaming("https://volc/out.mp4", "9", 1024, null, callerDeadline);
        verify(relay).persistStreamingInternal(eq("https://volc/out.mp4"), eq("9"), eq(1024L),
                isNull(), same(callerDeadline), isNull(), any(), any());
    }

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
        assertThat(elapsedMs).isGreaterThan(600);
        assertThat(stored.size()).isEqualTo((long) blockBytes * 2);
        assertThat(uploadedBytes.get()).isEqualTo((long) blockBytes * 2);
        assertThat(stored.md5()).isEqualTo(expectedMd5(slice, 2));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
        verify(client, never()).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
    }

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

        assertThat(Duration.ofNanos(System.nanoTime() - startNanos))
                .isLessThan(Duration.ofSeconds(3));
        verify(client, never()).putObject(any(PutObjectInput.class));
        assertThat(relayTempFiles()).isEqualTo(tempBefore);
    }

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

    @Test
    @Timeout(15)
    @DisplayName("上传段任务截止到点：归因「任务执行截止时间已到」不误报网络失败，已落地未发布对象被清理")
    void taskDeadlineDuringUpload_reportsDeadlineNotNetworkFailure() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        var received = new java.util.concurrent.CountDownLatch(1);
        List<String> before = relayTempFiles();
        deleteObjectsFromState(client);
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            stubPresignedUrlToSocket(client, socketServer);
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(5000);
                    SocketPut put = readPut(socket, 4096);
                    tosObjects.put(put.key(), put.body());
                    received.countDown();
                    return socket.getInputStream().read();
                }
            });
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES,
                            null, java.time.LocalDateTime.now().plusNanos(2_500_000_000L)));
            try {
                assertThat(received.await(5, java.util.concurrent.TimeUnit.SECONDS))
                        .as("上传 body 必须先完整送达并在替身落地").isTrue();
                assertThat(tosObjects).isNotEmpty();
                assertThatThrownBy(() -> transfer.get(8, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class)
                        .hasCauseInstanceOf(VideoProviderError.class)
                        .hasMessageContaining(TosVideoMediaRelay.TASK_DEADLINE_ABORT_MESSAGE)
                        .hasMessageNotContaining("转存网络失败");
                assertThat(peer.get(3, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(-1);
                var deleted = org.mockito.ArgumentCaptor.forClass(
                        com.volcengine.tos.model.object.DeleteObjectInput.class);
                verify(client).deleteObject(deleted.capture());
                assertThat(deleted.getValue().getBucket()).isEqualTo("bkt");
                assertThat(deleted.getValue().getKey()).startsWith("generated/9/video/");
                assertThat(tosObjects).doesNotContainKey(deleted.getValue().getKey());
                assertThat(tosObjects).isEmpty();
                assertThat(relayTempFiles()).isEqualTo(before);
            } finally {
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }

    @Test
    @Timeout(15)
    @DisplayName("上传成功响应先于截止返回：转存成功返回，对象保留（成功路径绝不删对象）")
    void taskDeadline_uploadSuccessBeforeDeadline_returnsAndKeepsObject() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        var received = new java.util.concurrent.CountDownLatch(1);
        List<String> before = relayTempFiles();
        deleteObjectsFromState(client);
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            stubPresignedUrlToSocket(client, socketServer);
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(5000);
                    SocketPut put = readPut(socket, 4096);
                    tosObjects.put(put.key(), put.body());
                    received.countDown();
                    Thread.sleep(1200);
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"
                            .getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().flush();
                    return 0;
                }
            });
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES,
                            null, java.time.LocalDateTime.now().plusSeconds(5)));
            try {
                assertThat(received.await(4, java.util.concurrent.TimeUnit.SECONDS))
                        .as("上传 body 必须先完整送达并在替身落地").isTrue();
                TosVideoMediaRelay.StoredVideo stored =
                        transfer.get(7, java.util.concurrent.TimeUnit.SECONDS);
                assertThat(stored.size()).isEqualTo(4096L);
                verify(client, never()).deleteObject(
                        any(com.volcengine.tos.model.object.DeleteObjectInput.class));
                assertThat(tosObjects).hasSize(1);
                String storedKey = tosObjects.keys().nextElement();
                assertThat(storedKey).startsWith("generated/9/video/");
                assertThat(stored.storageKey()).isEqualTo(storedKey);
                assertThat(tosObjects.get(storedKey)).hasSize(4096);
                assertThat(relayTempFiles()).isEqualTo(before);
                assertThat(peer.get(3, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(0);
            } finally {
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }

    @Test
    @Timeout(15)
    @DisplayName("上传响应窗口截止且清理失败：仍以截止失败口径退出，对象身份进入清理调用，临时文件不残留")
    void taskDeadline_uploadCleanupFailure_keepsDeadlineSemantics() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        var received = new java.util.concurrent.CountDownLatch(1);
        List<String> before = relayTempFiles();
        doThrow(new RuntimeException("tos unavailable"))
                .when(client).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            stubPresignedUrlToSocket(client, socketServer);
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(5000);
                    SocketPut put = readPut(socket, 4096);
                    tosObjects.put(put.key(), put.body());
                    received.countDown();
                    return socket.getInputStream().read();
                }
            });
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES,
                            null, java.time.LocalDateTime.now().plusNanos(2_500_000_000L)));
            try {
                assertThat(received.await(5, java.util.concurrent.TimeUnit.SECONDS))
                        .as("上传 body 必须先完整送达并在替身落地").isTrue();
                assertThatThrownBy(() -> transfer.get(8, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class)
                        .hasCauseInstanceOf(VideoProviderError.class)
                        .hasMessageContaining(TosVideoMediaRelay.TASK_DEADLINE_ABORT_MESSAGE)
                        .hasMessageNotContaining("转存网络失败");
                assertThat(peer.get(3, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(-1);
                var deleted = org.mockito.ArgumentCaptor.forClass(
                        com.volcengine.tos.model.object.DeleteObjectInput.class);
                verify(client).deleteObject(deleted.capture());
                assertThat(deleted.getValue().getBucket()).isEqualTo("bkt");
                assertThat(deleted.getValue().getKey()).startsWith("generated/9/video/");
                assertThat(tosObjects).containsKey(deleted.getValue().getKey());
                assertThat(relayTempFiles()).isEqualTo(before);
            } finally {
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }

    @Test
    @Timeout(15)
    @DisplayName("四参口径：上传失败（HTTP 503）维持不清理，不上传成功自然无孤儿，临时文件不残留")
    void fourArgs_uploadFailure_skipsUnpublishedCleanup() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        List<String> before = relayTempFiles();
        deleteObjectsFromState(client);
        uploadServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        uploadServer.createContext("/", exchange -> {
            exchange.getRequestBody().transferTo(OutputStream.nullOutputStream());
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        uploadServer.start();
        doAnswer(invocation -> {
            PreSignedURLInput input = invocation.getArgument(0);
            return new PreSignedURLOutput(
                    "http://127.0.0.1:" + uploadServer.getAddress().getPort() + "/" + input.getKey(),
                    java.util.Map.of());
        }).when(client).preSignedURL(any(PreSignedURLInput.class));

        assertThatThrownBy(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES, null))
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining("生成视频转存失败: HTTP 503");

        verify(client, never()).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
        assertThat(tosObjects).isEmpty();
        assertThat(relayTempFiles()).isEqualTo(before);
    }


    @Test
    @Timeout(15)
    @DisplayName("响应头未返回时外部中止：立即取消下载请求（延迟远小于 60s 响应头超时），连接真关")
    void externalAbortDuringHeaderWait_cancelsRequestPromptly() throws Exception {
        TOSV2 client = mock(TOSV2.class);
        var handle = new TosVideoMediaRelay.TransferAbortHandle();
        var headerReceived = new java.util.concurrent.CountDownLatch(1);
        List<String> before = relayTempFiles();
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            String url = "http://127.0.0.1:" + socketServer.getLocalPort() + "/slow-header.bin";
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(10_000);
                    InputStream in = socket.getInputStream();
                    var header = new java.io.ByteArrayOutputStream();
                    int next;
                    while ((next = in.read()) != -1) {
                        header.write(next);
                        if (header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
                    }
                    headerReceived.countDown();
                    return in.read();
                }
            });
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES, handle));
            try {
                assertThat(headerReceived.await(5, java.util.concurrent.TimeUnit.SECONDS))
                        .as("下载请求必须到达真实 HTTP 传输层").isTrue();
                long abortAt = System.nanoTime();
                handle.abort("结果转存租约丢失");
                assertThatThrownBy(() -> transfer.get(5, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class)
                        .hasCauseInstanceOf(TosVideoMediaRelay.TransferAbortedException.class)
                        .hasMessageContaining("结果转存租约丢失");
                long abortDelayMs = Duration.ofNanos(System.nanoTime() - abortAt).toMillis();
                System.out.printf("[IKIN01] 响应头等待期外部中止延迟 %dms（60s 响应头超时为对照基准）%n",
                        abortDelayMs);
                assertThat(abortDelayMs)
                        .as("abort→异常延迟 %dms，须远小于 60s 响应头超时", abortDelayMs)
                        .isLessThan(5_000L);
                assertThat(peer.get(5, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(-1);
                assertThat(relayTempFiles()).isEqualTo(before);
                verify(client, never()).putObject(any(PutObjectInput.class));
            } finally {
                handle.abort("test cleanup");
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }

    @Test
    @Timeout(15)
    @DisplayName("响应头未返回时任务截止到点：立即取消下载请求并归因截止，不误报网络失败")
    void taskDeadlineDuringHeaderWait_cancelsRequestPromptly() throws Exception {
        TOSV2 client = mock(TOSV2.class);
        var headerReceived = new java.util.concurrent.CountDownLatch(1);
        List<String> before = relayTempFiles();
        try (var socketServer = new java.net.ServerSocket(0, 1,
                java.net.InetAddress.getLoopbackAddress());
             var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            socketServer.setSoTimeout(5000);
            String url = "http://127.0.0.1:" + socketServer.getLocalPort() + "/slow-header.bin";
            var peer = executor.submit(() -> {
                try (var socket = socketServer.accept()) {
                    socket.setSoTimeout(10_000);
                    InputStream in = socket.getInputStream();
                    var header = new java.io.ByteArrayOutputStream();
                    int next;
                    while ((next = in.read()) != -1) {
                        header.write(next);
                        if (header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n")) break;
                    }
                    headerReceived.countDown();
                    return in.read();
                }
            });
            long startNanos = System.nanoTime();
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(url, "9", VideoMattingContract.MAX_RESULT_BYTES,
                            null, java.time.LocalDateTime.now().plusNanos(500_000_000)));
            try {
                assertThat(headerReceived.await(5, java.util.concurrent.TimeUnit.SECONDS))
                        .as("下载请求必须到达真实 HTTP 传输层").isTrue();
                assertThatThrownBy(() -> transfer.get(5, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class)
                        .hasCauseInstanceOf(VideoProviderError.class)
                        .hasMessageContaining(TosVideoMediaRelay.TASK_DEADLINE_ABORT_MESSAGE)
                        .hasMessageNotContaining("转存网络失败");
                long elapsedMs = Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
                System.out.printf("[IKIN01] 响应头等待期任务截止中止延迟 %dms（截止注入 500ms，60s 响应头超时为对照基准）%n",
                        elapsedMs);
                assertThat(elapsedMs)
                        .as("截止→异常延迟 %dms，须远小于 60s 响应头超时", elapsedMs)
                        .isLessThan(5_000L);
                assertThat(peer.get(5, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(-1);
                assertThat(relayTempFiles()).isEqualTo(before);
                verify(client, never()).putObject(any(PutObjectInput.class));
            } finally {
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }

    @Test
    @Timeout(15)
    @DisplayName("上传响应窗口中止且清理失败：仍以中止语义退出，对象身份进入清理调用，临时文件不残留")
    void externalAbort_uploadCleanupFailure_keepsAbortSemantics() throws Exception {
        String source = serve("video/mp4", 200, 4096, new byte[4096]);
        TOSV2 client = mock(TOSV2.class);
        var handle = new TosVideoMediaRelay.TransferAbortHandle();
        var received = new java.util.concurrent.CountDownLatch(1);
        List<String> before = relayTempFiles();
        doThrow(new RuntimeException("tos unavailable"))
                .when(client).deleteObject(any(com.volcengine.tos.model.object.DeleteObjectInput.class));
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
                    return in.read();
                }
            });
            var transfer = executor.submit(() -> new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                    .persistStreaming(source, "9", VideoMattingContract.MAX_RESULT_BYTES, handle));
            try {
                assertThat(received.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                handle.abort("lease lost");
                assertThatThrownBy(() -> transfer.get(2, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class)
                        .hasCauseInstanceOf(TosVideoMediaRelay.TransferAbortedException.class)
                        .hasMessageContaining("lease lost");
                assertThat(peer.get(2, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(-1);
                var deleted = org.mockito.ArgumentCaptor.forClass(
                        com.volcengine.tos.model.object.DeleteObjectInput.class);
                verify(client).deleteObject(deleted.capture());
                assertThat(deleted.getValue().getBucket()).isEqualTo("bkt");
                assertThat(deleted.getValue().getKey()).startsWith("generated/9/video/");
                assertThat(relayTempFiles()).isEqualTo(before);
            } finally {
                handle.abort("test cleanup");
                socketServer.close();
                transfer.cancel(true);
                peer.cancel(true);
            }
        }
    }

    @Test
    @Timeout(15)
    @DisplayName("裸 CancellationException（cancel 后 join 的规范路径）：按外部中止/任务截止归因，不逃逸")
    void headerWait_bareCancellation_attributedNotEscaped() {
        CompletableFuture<HttpResponse<InputStream>> aborted = new CompletableFuture<>();
        var handle = new TosVideoMediaRelay.TransferAbortHandle();
        TosVideoMediaRelay.HeaderWait abortWait = new TosVideoMediaRelay.HeaderWait(aborted, handle, null);
        handle.abort("结果转存租约丢失");
        assertThatThrownBy(aborted::join)
                .isInstanceOf(java.util.concurrent.CancellationException.class);
        assertThatThrownBy(abortWait::await)
                .isInstanceOf(TosVideoMediaRelay.TransferAbortedException.class)
                .hasMessageContaining("结果转存租约丢失");

        CompletableFuture<HttpResponse<InputStream>> expired = new CompletableFuture<>();
        TosVideoMediaRelay.HeaderWait deadlineWait =
                new TosVideoMediaRelay.HeaderWait(expired, null, java.time.LocalDateTime.now().plusNanos(100_000_000));
        assertThatThrownBy(deadlineWait::await)
                .isInstanceOf(VideoProviderError.class)
                .hasMessageContaining(TosVideoMediaRelay.TASK_DEADLINE_ABORT_MESSAGE)
                .hasMessageNotContaining("转存网络失败");
    }

    @Test
    @DisplayName("video/info 解析：取真实视频流宽高，跳过封面图流")
    void parseVideoDimensions_picksRealVideoStream() {
        String body = "{\"streams\":["
                + "{\"codec_type\":\"video\",\"disposition\":{\"attached_pic\":1},\"width\":400,\"height\":400},"
                + "{\"codec_type\":\"video\",\"disposition\":{\"attached_pic\":0},\"width\":720,\"height\":1280}]}";

        assertThat(TosVideoMediaRelay.parseVideoDimensions(body)).containsExactly(720, 1280);
    }

    @Test
    @DisplayName("video/info 无视频流或非法 JSON → 留空")
    void parseVideoDimensions_missingVideoStream() {
        assertThat(TosVideoMediaRelay.parseVideoDimensions(
                "{\"streams\":[{\"codec_type\":\"audio\",\"width\":0,\"height\":0}]}")).isNull();
        assertThat(TosVideoMediaRelay.parseVideoDimensions("not-json")).isNull();
    }

    @Test
    @DisplayName("TOS media info 探测：预签名 URL 带 x-tos-process=video/info，返回真实宽高")
    void probeVideoDimensions_readsMediaInfo() throws Exception {
        byte[] body = "{\"streams\":[{\"codec_type\":\"video\",\"width\":1900,\"height\":1090}]}"
                .getBytes(StandardCharsets.UTF_8);
        String url = serve("application/json", 200, body.length, body);
        TOSV2 client = mock(TOSV2.class);
        var captured = new java.util.concurrent.atomic.AtomicReference<PreSignedURLInput>();
        doAnswer(invocation -> {
            PreSignedURLInput input = invocation.getArgument(0);
            captured.set(input);
            return new PreSignedURLOutput(url, java.util.Map.of());
        }).when(client).preSignedURL(any(PreSignedURLInput.class));

        int[] dims = new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .probeVideoDimensions("generated/9/video/a.mp4");

        assertThat(dims).containsExactly(1900, 1090);
        assertThat(captured.get().getBucket()).isEqualTo("bkt");
        assertThat(captured.get().getKey()).isEqualTo("generated/9/video/a.mp4");
        assertThat(captured.get().getQuery()).containsEntry("x-tos-process", "video/info");
    }

    @Test
    @DisplayName("TOS media info 返回非 2xx → 宽高留空，不抛异常")
    void probeVideoDimensions_httpErrorReturnsNull() throws Exception {
        String url = serve("text/plain", 404, 0, patternBlock());
        TOSV2 client = mock(TOSV2.class);
        doAnswer(invocation -> new PreSignedURLOutput(url, java.util.Map.of()))
                .when(client).preSignedURL(any(PreSignedURLInput.class));

        assertThat(new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .probeVideoDimensions("generated/9/video/a.mp4")).isNull();
    }

    @Test
    @DisplayName("空 storageKey → 不请求，直接留空")
    void probeVideoDimensions_blankKeyReturnsNull() {
        TOSV2 client = mock(TOSV2.class);

        assertThat(new TosVideoMediaRelay(client, "bkt", "tos.example.com")
                .probeVideoDimensions(" ")).isNull();
        verify(client, never()).preSignedURL(any(PreSignedURLInput.class));
    }
}
