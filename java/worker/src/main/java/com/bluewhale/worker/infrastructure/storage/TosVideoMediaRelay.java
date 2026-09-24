package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.ObjectMetaRequestOptions;
import com.volcengine.tos.model.object.PutObjectACLInput;
import com.volcengine.tos.model.object.PutObjectInput;
import com.volcengine.tos.model.object.PreSignedURLInput;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * 视频媒体转存（tos-video-media-relay.ts 移植；IKGS73 起非逐字——出参多带 {@code md5}）。
 * <p>
 * 转存流程：fetch 源 URL → 校验 video/ mime → TOS PUT → putObjectAcl public-read。
 * <p>
 * key 格式：{@code generated/{userId}/video/{uuid去横线}.{ext}}（:96）。
 * 扩展名映射（:150-154 videoExtension）：webm → webm, quicktime → mov, 其余 → mp4。
 * <p>
 * 上限：{@link #persist} 200MB（:76 maxVideoBytes，结果整段进堆故上限与堆绑）；大结果走
 * {@link #persistStreaming}——上限由调用方按工具口径给，下载落临时文件、上传从文件流式读，
 * 与堆解绑（IKHJRC 审查修复 P2：智能抠像 10 分钟档成品可超 200MB）。
 * <p>
 * GENERATION_MEDIA_RELAY_MODE env：tos（默认）/ passthrough（:21-29）。
 * passthrough 返回源 URL 不变（:125-136），生产环境禁止（:25-28）。
 * <b>Java 侧仅 port 注释</b>——生产 env 不在此进程，不实现 passthrough 运行时守卫。
 * <p>
 * 修正一：quota/actual_amount_fen 不在此范围。
 */
public class TosVideoMediaRelay {

    private static final Logger log = LoggerFactory.getLogger(TosVideoMediaRelay.class);

    /** 视频转存大小上限（tos-video-media-relay.ts:76，200MB）。 */
    static final long MAX_VIDEO_BYTES = 200L * 1024 * 1024;

    /**
     * 流式转存的响应头等待超时 60s（同字节数组路径值）。探针实证：{@code BodyHandlers.ofInputStream}
     * 语义下 {@code HttpRequest.timeout} 只覆盖到响应头（1s 超时 + 4s 慢 body 实测正常读完），
     * 故此值不约束大文件下载本身，body 段由 {@link #STREAM_COPY_DEADLINE} 兜底。
     */
    private static final Duration STREAM_HEADER_TIMEOUT = Duration.ofSeconds(60);

    /**
     * 流式下载整段兜底时限 10 分钟：流式 body 不受 request timeout 约束，对端「连上但不吐数据」
     * 必须由 {@link StreamWatchdog} 到点主动 close 响应流中止（截止检查只在 read 返回后执行，
     * 停流时永远走不到）；同时给 1GiB 级结果留出 ≥1.7MB/s 的可用带宽。
     */
    private static final Duration STREAM_COPY_DEADLINE = Duration.ofMinutes(10);

    /**
     * 错误响应正文读取截止 60s（IKHSFC）：错误体至多读 4096 字节，正常毫秒级完成；此前
     * {@code readNBytes} 无任何约束，错误响应停流同样挂死工作线程，与正文停流同口径由看门狗中止。
     */
    private static final Duration STREAM_ERROR_BODY_TIMEOUT = Duration.ofSeconds(60);

    /** 看门狗定时器（daemon 单线程，进程级共享）：只负责到点 close 响应流，无状态轮询。 */
    private static final ScheduledExecutorService WATCHDOG_SCHEDULER =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "video-relay-watchdog");
                t.setDaemon(true);
                return t;
            });

    // SDK 仅负责签名；逐请求持有 Call，失租时能取消 socket 写入和响应等待。
    private static final OkHttpClient UPLOAD_CLIENT = new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(30))
            .readTimeout(Duration.ofSeconds(60))
            .writeTimeout(Duration.ofSeconds(60))
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(false)
            .build();

    private final TOSV2 client;
    private final String bucket;
    private final String endpoint;
    private final HttpClient httpClient;

    public TosVideoMediaRelay(TOSV2 client, String bucket, String endpoint) {
        this.client = client;
        this.bucket = bucket;
        this.endpoint = endpoint;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    /**
     * 从环境变量构建 TOS 视频转存。
     * 5 个 env 全必需（与 TosMediaStorage 同源）。
     */
    public static TosVideoMediaRelay fromEnv() {
        String accessKeyId = System.getenv("VOLC_ACCESS_KEY_ID");
        String secretAccessKey = System.getenv("VOLC_SECRET_ACCESS_KEY");
        String endpointEnv = System.getenv("VOLC_TOS_ENDPOINT");
        String bucketEnv = System.getenv("VOLC_TOS_BUCKET");
        String region = System.getenv("VOLC_TOS_REGION");

        if (isBlank(accessKeyId) || isBlank(secretAccessKey)
                || isBlank(endpointEnv) || isBlank(bucketEnv) || isBlank(region)) {
            return null; // TOS 未配置 → 降级（video 与 image 不同：硬失败更合适，但保持宽容）
        }

        String normalizedEndpoint = endpointEnv.replaceFirst("^https?://", "").replaceFirst("/$", "");
        TOSV2 client = new TOSV2ClientBuilder().build(region, normalizedEndpoint, accessKeyId, secretAccessKey);
        return new TosVideoMediaRelay(client, bucketEnv, normalizedEndpoint);
    }

    /**
     * 转存视频（tos-video-media-relay.ts:84-122 persist）。
     * <p>
     * fetch → 校验 → PUT → makePublic。
     *
     * @param sourceUrl 上游生成的视频 URL
     * @param userId    归属用户（key 路径用）
     * @return 转存结果
     * @throws RuntimeException 下载/校验/上传失败
     */
    public StoredVideo persist(String sourceUrl, String userId) {
        // 1. fetch 源 URL（:85-86）
        byte[] bytes;
        String mime;
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(sourceUrl))
                    .timeout(Duration.ofSeconds(60))
                    .GET()
                    .build();
            HttpResponse<byte[]> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() >= 400) {
                String errBody = new String(resp.body(), java.nio.charset.StandardCharsets.UTF_8);
                String truncated = errBody.length() > 300 ? errBody.substring(0, 300) + "…" : errBody;
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频下载失败: HTTP " + resp.statusCode() + " body=" + truncated);
            }
            bytes = resp.body();
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            mime = contentType != null
                    ? contentType.split(";", 2)[0].trim()
                    : "video/mp4";
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成视频下载失败: " + e.getMessage(), e);
        }

        // 2. 校验（:88-93）
        if (!mime.startsWith("video/")) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成结果不是视频");
        }
        if (bytes.length == 0) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频为空");
        }
        if (bytes.length > MAX_VIDEO_BYTES) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频超过转存上限");
        }

        // 3. 上传（:95-113）
        String extension = videoExtension(mime);
        String uuid = UUID.randomUUID().toString().replace("-", "");
        String storageKey = "generated/" + userId + "/video/" + uuid + "." + extension;

        try {
            ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                    .setHeaders(Map.of("Content-Type", mime));
            PutObjectInput putInput = new PutObjectInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setContent(new ByteArrayInputStream(bytes))
                    .setContentLength((long) bytes.length)
                    .setOptions(options);
            client.putObject(putInput);

            // makePublic（:109-113）
            PutObjectACLInput aclInput = new PutObjectACLInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setAcl(ACLType.ACL_PUBLIC_READ);
            client.putObjectAcl(aclInput);
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成视频转存失败: " + e.getMessage(), e);
        }

        String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
        return new StoredVideo(publicUrl, storageKey, mime, (long) bytes.length,
                ContentDigest.md5Hex(bytes));
    }

    /**
     * 流式转存（IKHJRC 审查修复 P2）：与 {@link #persist} 同流程（下载 → video/ mime 校验 →
     * TOS PUT → public-read），差异只在**内容不整段进堆**——下载分块落临时文件、边落边判
     * {@code maxBytes}、边算 md5，上传再从文件流式读。故上限由调用方按工具口径给（字节数组
     * 路径的 200MB 是与堆绑死的常量），成品超过上限即失败（终态失败由调用方归并，重试不解决）。
     * <p>
     * 临时文件落在系统临时目录，正常与异常路径都删（失败留垃圾会把容器盘吃满）。同一
     * {@code maxBytes} 语义与字节数组路径一致：等于上限通过、大于上限拒绝。
     *
     * @param sourceUrl 上游生成的视频 URL
     * @param userId    归属用户（key 路径用）
     * @param maxBytes  成品大小上限（调用方按本工具输出规模给；超出即拒）
     * @return 转存结果
     * @throws RuntimeException 下载 / 校验 / 上传失败（同 {@link #persist} 的错误类型）
     */
    public StoredVideo persistStreaming(String sourceUrl, String userId, long maxBytes) {
        return persistStreaming(sourceUrl, userId, maxBytes, null);
    }

    /**
     * 流式转存（带外部中止句柄）：句柄触发（如 IKHSFD 的转存期租约心跳未命中）会主动中止
     * 正在进行的下载/上传，以 {@link TransferAbortedException} 退出——调用方据此静默放弃
     * 本 worker 的发布（任务已被接管），不落失败终态。句柄可为 null（无外部中止源）。
     */
    public StoredVideo persistStreaming(String sourceUrl, String userId, long maxBytes,
                                        TransferAbortHandle abortHandle) {
        return persistStreamingInternal(sourceUrl, userId, maxBytes, abortHandle,
                STREAM_COPY_DEADLINE, STREAM_ERROR_BODY_TIMEOUT);
    }

    /**
     * 全参内部版（IKHSFC）：截止时间可注入，测试用短截止验证停流主动中止（不真等 10 分钟）。
     */
    StoredVideo persistStreamingInternal(String sourceUrl, String userId, long maxBytes,
                                         TransferAbortHandle abortHandle,
                                         Duration copyDeadline, Duration errorBodyTimeout) {
        Path tempFile = null;
        try {
            tempFile = Files.createTempFile("video-relay-", ".part");

            // 1. 下载到临时文件（响应头等待走 60s；错误体与正文段各自布防看门狗——停流时
            //    截止检查在阻塞 read 里走不到，必须由看门狗到点主动 close 响应流打断读取）
            long size;
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(sourceUrl))
                    .timeout(STREAM_HEADER_TIMEOUT)
                    .GET()
                    .build();
            HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            String mime = contentType != null ? contentType.split(";", 2)[0].trim() : "video/mp4";
            try (InputStream body = resp.body();
                 StreamWatchdog watchdog = new StreamWatchdog(body, abortHandle)) {
                if (resp.statusCode() >= 400) {
                    watchdog.armTimeout(errorBodyTimeout);
                    String errBody;
                    try {
                        errBody = new String(body.readNBytes(4096), java.nio.charset.StandardCharsets.UTF_8);
                    } catch (IOException e) {
                        throw watchdog.translateReadFailure(e, true, errorBodyTimeout);
                    }
                    String truncated = errBody.length() > 300 ? errBody.substring(0, 300) + "…" : errBody;
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                            "生成视频下载失败: HTTP " + resp.statusCode() + " body=" + truncated);
                }
                // 2. 校验 mime 在校验体之前（不是视频就不必落盘）
                if (!mime.startsWith("video/")) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成结果不是视频");
                }
                watchdog.armTimeout(copyDeadline);
                try {
                    size = copyToFile(body, tempFile, maxBytes, sourceUrl, copyDeadline);
                } catch (IOException e) {
                    throw watchdog.translateReadFailure(e, false, copyDeadline);
                }
                watchdog.disarm();
                if (size == 0) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频为空");
                }
                String md5 = ContentDigest.md5Hex(tempFile);

                // 3. 同 key / mime / ACL；ACL 随 PUT 原子提交，避免上传后再发不可取消的 ACL 请求。
                String extension = videoExtension(mime);
                String uuid = UUID.randomUUID().toString().replace("-", "");
                String storageKey = "generated/" + userId + "/video/" + uuid + "." + extension;
                watchdog.requireNotAborted();
                Map<String, String> headers = Map.of(
                        "Content-Type", mime, "x-tos-acl", "public-read");
                var signed = client.preSignedURL(new PreSignedURLInput()
                        .setHttpMethod("PUT").setBucket(bucket).setKey(storageKey)
                        .setExpires(3600).setHeader(headers).setSignedAllHeaders(true));
                Request.Builder upload = new Request.Builder().url(signed.getSignedUrl())
                        .put(RequestBody.create(tempFile.toFile(), okhttp3.MediaType.parse(mime)));
                headers.forEach(upload::header);
                signed.getSignedHeader().forEach(upload::header);
                watchdog.upload(UPLOAD_CLIENT.newCall(upload.build()));
                watchdog.requireNotAborted();

                log.info("流式转存完成 storageKey={} size={} mime={}", storageKey, size, mime);
                String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
                return new StoredVideo(publicUrl, storageKey, mime, size, md5);
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成视频下载失败: " + e.getMessage(), e);
        } finally {
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (IOException e) {
                    log.warn("转存临时文件清理失败 path={} err={}", tempFile, e.getMessage());
                }
            }
        }
    }

    /** 分块落盘：边读边判上限与截止（上限语义同字节数组路径——等于上限通过；停流的阻塞中止由看门狗兜）。 */
    private long copyToFile(InputStream in, Path target, long maxBytes, String sourceUrl,
                            Duration copyDeadline) throws IOException {
        long deadlineNanos = System.nanoTime() + copyDeadline.toNanos();
        long total = 0;
        byte[] buffer = new byte[64 * 1024];
        try (OutputStream out = Files.newOutputStream(target)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                            "生成视频超过转存上限（> " + (maxBytes / (1024 * 1024)) + "MB）: " + sourceUrl);
                }
                if (System.nanoTime() > deadlineNanos) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                            "生成视频下载超时（超过 " + describeDuration(copyDeadline) + "）");
                }
                out.write(buffer, 0, read);
            }
        }
        return total;
    }

    /**
     * 视频扩展名映射（tos-video-media-relay.ts:150-154 videoExtension）。
     */
    static String videoExtension(String mime) {
        if ("video/webm".equals(mime)) return "webm";
        if ("video/quicktime".equals(mime)) return "mov";
        return "mp4";
    }

    /** 转存结果（video-job-runner.ts:89-94 StoredVideo 逐字移植，IKGS73 起多带 {@code md5}）。 */
    public record StoredVideo(String url, String storageKey, String mime, Long size, String md5) {}

    /**
     * 传输中止句柄（IKHSFC 建通道，IKHSFD 消费）：调用方（如转存期租约心跳）在确认应放弃
     * 本次传输时 {@link #abort(String)}；传输内部接线后到点主动 close 响应流 / 取消上传 HTTP 请求，
     * 以 {@link TransferAbortedException} 退出。接线前触发同样生效（wire 时补触发）。
     */
    public static final class TransferAbortHandle {
        private volatile Runnable action;
        private volatile String reason;

        /** 请求中止（幂等，首次生效；可从任意线程调用）。 */
        public void abort(String reason) {
            Runnable wired;
            synchronized (this) {
                if (this.reason != null) return;
                this.reason = java.util.Objects.requireNonNull(reason);
                wired = action;
            }
            if (wired != null) wired.run();
        }

        public boolean aborted() {
            return reason != null;
        }

        /** 中止原因（未中止为 null）：调用方与测试透传日志用。 */
        public String reason() {
            return reason;
        }

        synchronized void wire(Runnable action) {
            this.action = action;
            if (reason != null) action.run();
        }

        synchronized void unwire() {
            action = null;
        }
    }

    /** 传输被外部信号中止（非失败口径）：调用方应静默放弃本 worker 的发布（如租约已被接管）。 */
    public static final class TransferAbortedException extends RuntimeException {
        public TransferAbortedException(String reason) {
            super(reason);
        }
    }

    /**
     * 传输看门狗（IKHSFC）：截止到期或外部句柄触发时主动 close 正在读取的响应流，打断阻塞中的
     * read（JDK HttpClient 的响应流 close 会让阻塞读抛 IOException——此前截止检查只在 read
     * 返回后执行，停流时永远走不到，500ms 仍阻塞的审查探针即此因）。读取侧 IOException 经
     * {@link #translateReadFailure} 归因；上传侧经逐请求 Call.cancel 与外部中止状态检查
     * 同口径中止。每个 {@code persistStreamingInternal} 调用一个实例，try-with-resources 释放。
     */
    private static final class StreamWatchdog implements AutoCloseable {
        private final InputStream body;
        private final TransferAbortHandle handle;
        private volatile ScheduledFuture<?> timeoutTask;
        private volatile boolean timeoutAbort;
        private volatile boolean externalAbort;
        private volatile Call activeUpload;

        StreamWatchdog(InputStream body, TransferAbortHandle handle) {
            this.body = body;
            this.handle = handle;
            if (handle != null) {
                handle.wire(this::abortFromExternal);
            }
        }

        /** 布防截止（错误体 / 正文拷贝阶段各自布防；重复布防替换旧任务）。 */
        void armTimeout(Duration deadline) {
            ScheduledFuture<?> previous = timeoutTask;
            if (previous != null) previous.cancel(false);
            timeoutTask = WATCHDOG_SCHEDULER.schedule(this::abortFromTimeout,
                    deadline.toNanos(), TimeUnit.NANOSECONDS);
        }

        /** 撤防（下载正常完成后取消定时；外部中止通道保持接通直到 {@link #close()}）。 */
        void disarm() {
            ScheduledFuture<?> task = timeoutTask;
            if (task != null) task.cancel(false);
        }

        private void abortFromTimeout() {
            timeoutAbort = true;
            closeBodyQuietly();
        }

        private void abortFromExternal() {
            externalAbort = true;
            Call upload = activeUpload;
            if (upload != null) upload.cancel();
            closeBodyQuietly();
        }

        private void closeBodyQuietly() {
            try {
                body.close();
            } catch (IOException ignored) {
                // 对端已断/流已关：中止目的已达成
            }
        }

        String externalReason() {
            return handle != null ? handle.reason() : null;
        }

        /** 读取侧 IOException 归因：外部中止优先 → 超时 → 其余包供应商错误。 */
        RuntimeException translateReadFailure(IOException e, boolean errorBodyPhase, Duration deadline) {
            if (externalAbort) {
                return new TransferAbortedException(externalReason());
            }
            if (timeoutAbort) {
                String phase = errorBodyPhase ? "错误响应正文读取超时" : "生成视频下载超时";
                return new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        phase + "（超过 " + describeDuration(deadline) + "）", e);
            }
            return new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成视频下载失败: " + e.getMessage(), e);
        }

        void requireNotAborted() {
            if (externalAbort) throw new TransferAbortedException(externalReason());
        }

        void upload(Call call) {
            activeUpload = call;
            try {
                requireNotAborted();
                try (Response response = call.execute()) {
                    requireNotAborted();
                    if (!response.isSuccessful()) {
                        throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                                "生成视频转存失败: HTTP " + response.code());
                    }
                }
            } catch (IOException e) {
                requireNotAborted();
                // 不带签名 URL / SDK 凭证进入用户错误或日志。
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频转存网络失败", e);
            } finally {
                activeUpload = null;
            }
        }

        @Override
        public void close() {
            disarm();
            if (handle != null) handle.unwire();
        }
    }

    /** 时限文案：≥1 分钟按分钟，不足按毫秒（测试注入亚秒级截止时也说得通）。 */
    private static String describeDuration(Duration d) {
        return d.toMillis() >= 60_000 ? d.toMinutes() + " 分钟" : d.toMillis() + "ms";
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
