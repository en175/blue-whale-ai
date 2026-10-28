package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.DeleteObjectInput;
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
import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class TosVideoMediaRelay {

    private static final Logger log = LoggerFactory.getLogger(TosVideoMediaRelay.class);

    static final long MAX_VIDEO_BYTES = 200L * 1024 * 1024;

    private static final Duration STREAM_HEADER_TIMEOUT = Duration.ofSeconds(60);

    private static final Duration STREAM_STALL_TIMEOUT = Duration.ofSeconds(60);

    private static final Duration STREAM_COPY_DEADLINE = Duration.ofMinutes(10);

    private static final Duration STREAM_ERROR_BODY_TIMEOUT = Duration.ofSeconds(60);

    static final String TASK_DEADLINE_ABORT_MESSAGE = "任务执行截止时间已到，中止结果转存";

    private static final Duration PROBE_TIMEOUT = Duration.ofSeconds(10);

    private static final String MEDIA_INFO_PROCESS = "video/info";

    private static final int MAX_MEDIA_INFO_BYTES = 256 * 1024;

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final ScheduledExecutorService WATCHDOG_SCHEDULER =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "video-relay-watchdog");
                t.setDaemon(true);
                return t;
            });

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

    public static TosVideoMediaRelay fromEnv() {
        String accessKeyId = System.getenv("VOLC_ACCESS_KEY_ID");
        String secretAccessKey = System.getenv("VOLC_SECRET_ACCESS_KEY");
        String endpointEnv = System.getenv("VOLC_TOS_ENDPOINT");
        String bucketEnv = System.getenv("VOLC_TOS_BUCKET");
        String region = System.getenv("VOLC_TOS_REGION");

        if (isBlank(accessKeyId) || isBlank(secretAccessKey)
                || isBlank(endpointEnv) || isBlank(bucketEnv) || isBlank(region)) {
            return null;
        }

        String normalizedEndpoint = endpointEnv.replaceFirst("^https?://", "").replaceFirst("/$", "");
        TOSV2 client = new TOSV2ClientBuilder().build(region, normalizedEndpoint, accessKeyId, secretAccessKey);
        return new TosVideoMediaRelay(client, bucketEnv, normalizedEndpoint);
    }

    public StoredVideo persist(String sourceUrl, String userId) {
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

        if (!mime.startsWith("video/")) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成结果不是视频");
        }
        if (bytes.length == 0) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频为空");
        }
        if (bytes.length > MAX_VIDEO_BYTES) {
            throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频超过转存上限");
        }

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

    public StoredVideo persistStreaming(String sourceUrl, String userId, long maxBytes) {
        return persistStreaming(sourceUrl, userId, maxBytes, null);
    }

    public StoredVideo persistStreaming(String sourceUrl, String userId, long maxBytes,
                                        TransferAbortHandle abortHandle) {
        return persistStreamingInternal(sourceUrl, userId, maxBytes, abortHandle,
                null, STREAM_COPY_DEADLINE, null, STREAM_ERROR_BODY_TIMEOUT);
    }

    public StoredVideo persistStreaming(String sourceUrl, String userId, long maxBytes,
                                        TransferAbortHandle abortHandle, LocalDateTime taskDeadline) {
        return persistStreamingInternal(sourceUrl, userId, maxBytes, abortHandle, taskDeadline,
                null, STREAM_STALL_TIMEOUT, STREAM_ERROR_BODY_TIMEOUT);
    }

    StoredVideo persistStreamingInternal(String sourceUrl, String userId, long maxBytes,
                                         TransferAbortHandle abortHandle, LocalDateTime taskDeadline,
                                         Duration copyWindow, Duration stallTimeout,
                                         Duration errorBodyTimeout) {
        Path tempFile = null;
        String uploadedKey = null;
        try {
            tempFile = Files.createTempFile("video-relay-", ".part");

            long size;
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(sourceUrl))
                    .timeout(STREAM_HEADER_TIMEOUT)
                    .GET()
                    .build();
            CompletableFuture<HttpResponse<InputStream>> pending =
                    httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofInputStream());
            HttpResponse<InputStream> resp =
                    new HeaderWait(pending, abortHandle, taskDeadline).await();
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            String mime = contentType != null ? contentType.split(";", 2)[0].trim() : "video/mp4";
            try (InputStream body = resp.body();
                 StreamWatchdog watchdog = new StreamWatchdog(body, abortHandle, stallTimeout)) {
                if (resp.statusCode() >= 400) {
                    watchdog.armTimeout(errorBodyTimeout);
                    String errBody;
                    try {
                        errBody = new String(body.readNBytes(4096), java.nio.charset.StandardCharsets.UTF_8);
                    } catch (IOException e) {
                        throw watchdog.translateReadFailure(e, errorBodyTimeout);
                    }
                    String truncated = errBody.length() > 300 ? errBody.substring(0, 300) + "…" : errBody;
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                            "生成视频下载失败: HTTP " + resp.statusCode() + " body=" + truncated);
                }
                if (!mime.startsWith("video/")) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成结果不是视频");
                }
                if (stallTimeout != null) watchdog.armStall();
                watchdog.armDeadline(taskDeadline);
                if (copyWindow != null) watchdog.armCopyWindow(copyWindow);
                try {
                    size = copyToFile(body, tempFile, maxBytes, sourceUrl, watchdog);
                } catch (IOException e) {
                    throw watchdog.translateReadFailure(e, errorBodyTimeout);
                }
                watchdog.disarmStall();
                watchdog.disarmCopyWindow();
                if (size == 0) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频为空");
                }
                String md5 = ContentDigest.md5Hex(tempFile);

                String extension = videoExtension(mime);
                String uuid = UUID.randomUUID().toString().replace("-", "");
                String storageKey = "generated/" + userId + "/video/" + uuid + "." + extension;
                uploadedKey = storageKey;
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
            if (uploadedKey != null && (e instanceof TransferAbortedException
                    || isTaskDeadlineAbort(e))) {
                deleteUnpublishedObject(uploadedKey);
            }
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

    private long copyToFile(InputStream in, Path target, long maxBytes, String sourceUrl,
                            StreamWatchdog watchdog) throws IOException {
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
                out.write(buffer, 0, read);
                watchdog.progress();
            }
        }
        return total;
    }

    private static boolean isTaskDeadlineAbort(RuntimeException e) {
        return e instanceof TaskDeadlineAbortException;
    }

    public void deleteUnpublishedObject(String storageKey) {
        try {
            client.deleteObject(new DeleteObjectInput().setBucket(bucket).setKey(storageKey));
            log.info("转存中止后清理未发布 TOS 对象 storageKey={}", storageKey);
        } catch (Exception e) {
            log.warn("转存中止后清理未发布 TOS 对象失败 storageKey={} err={}", storageKey, e.getMessage());
        }
    }

    public ProbedMediaInfo probeMediaInfo(String storageKey) {
        if (isBlank(storageKey)) return null;
        try {
            var signed = client.preSignedURL(new PreSignedURLInput()
                    .setHttpMethod("GET")
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setExpires(60)
                    .setQuery(Map.of("x-tos-process", MEDIA_INFO_PROCESS)));
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(signed.getSignedUrl()))
                    .timeout(PROBE_TIMEOUT)
                    .GET()
                    .build();
            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() >= 400) {
                    log.warn("TOS media info 探测失败 storageKey={} status={}", storageKey, response.statusCode());
                    return null;
                }
                byte[] bytes = body.readNBytes(MAX_MEDIA_INFO_BYTES + 1);
                if (bytes.length > MAX_MEDIA_INFO_BYTES) {
                    log.warn("TOS media info 响应超限，按探测失败处理 storageKey={}", storageKey);
                    return null;
                }
                return parseMediaInfo(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("TOS media info 探测被中断 storageKey={}", storageKey);
            return null;
        } catch (Exception e) {
            log.warn("TOS media info 探测异常 storageKey={} err={}", storageKey, e.getMessage());
            return null;
        }
    }

    static ProbedMediaInfo parseMediaInfo(String body) {
        try {
            JsonNode root = JSON.readTree(body);
            Double durationSec = positiveDouble(root.path("format").path("duration"));
            JsonNode streams = root.path("streams");
            Integer width = null;
            Integer height = null;
            if (streams.isArray()) {
                for (JsonNode stream : streams) {
                    if (!"video".equals(stream.path("codec_type").asText())) continue;
                    if (stream.path("disposition").path("attached_pic").asInt(0) == 1) continue;
                    if (width == null) {
                        int streamWidth = stream.path("width").asInt(0);
                        int streamHeight = stream.path("height").asInt(0);
                        if (streamWidth > 0 && streamHeight > 0) {
                            width = streamWidth;
                            height = streamHeight;
                        }
                    }
                    if (durationSec == null) durationSec = positiveDouble(stream.path("duration"));
                    if (width != null && durationSec != null) break;
                }
            }
            if (width == null && height == null && durationSec == null) return null;
            return new ProbedMediaInfo(width, height, durationSec);
        } catch (Exception e) {
            log.warn("TOS media info 解析失败 err={}", e.getMessage());
        }
        return null;
    }

    private static Double positiveDouble(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) return null;
        try {
            double value = node.isNumber() ? node.asDouble() : Double.parseDouble(node.asText());
            return Double.isFinite(value) && value > 0 ? value : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static String videoExtension(String mime) {
        if ("video/webm".equals(mime)) return "webm";
        if ("video/quicktime".equals(mime)) return "mov";
        return "mp4";
    }

    public record StoredVideo(String url, String storageKey, String mime, Long size, String md5) {}

    public record ProbedMediaInfo(Integer width, Integer height, Double durationSec) {}

    public static final class TransferAbortHandle {
        private volatile Runnable action;
        private volatile String reason;

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

    public static final class TransferAbortedException extends RuntimeException {
        public TransferAbortedException(String reason) {
            super(reason);
        }
    }

    public static final class TaskDeadlineAbortException extends VideoProviderError {
        TaskDeadlineAbortException() {
            super(GenerationError.ERROR_PROVIDER_FAILED, TASK_DEADLINE_ABORT_MESSAGE);
        }

        TaskDeadlineAbortException(Throwable cause) {
            super(GenerationError.ERROR_PROVIDER_FAILED, TASK_DEADLINE_ABORT_MESSAGE, cause);
        }
    }

    static final class HeaderWait {
        private final CompletableFuture<HttpResponse<InputStream>> pending;
        private final TransferAbortHandle handle;
        private volatile ScheduledFuture<?> deadlineTask;
        private volatile boolean deadlineAbort;

        HeaderWait(CompletableFuture<HttpResponse<InputStream>> pending,
                   TransferAbortHandle handle, LocalDateTime taskDeadline) {
            this.pending = pending;
            this.handle = handle;
            if (handle != null) {
                handle.wire(() -> pending.cancel(true));
            }
            if (taskDeadline != null) {
                deadlineTask = WATCHDOG_SCHEDULER.schedule(this::abortFromDeadline,
                        Math.max(0, Duration.between(LocalDateTime.now(), taskDeadline).toNanos()), TimeUnit.NANOSECONDS);
            }
        }

        private void abortFromDeadline() {
            deadlineAbort = true;
            pending.cancel(true);
        }

        HttpResponse<InputStream> await() {
            try {
                return pending.join();
            } catch (CompletionException | CancellationException e) {
                if (isCancellation(e)) {
                    if (handle != null && handle.aborted()) {
                        throw new TransferAbortedException(handle.reason());
                    }
                    if (deadlineAbort) {
                        throw new TaskDeadlineAbortException();
                    }
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频下载已取消", e);
                }
                Throwable cause = e.getCause() == null ? e : e.getCause();
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频下载失败: " + cause.getMessage(), cause);
            } finally {
                ScheduledFuture<?> task = deadlineTask;
                if (task != null) task.cancel(false);
            }
        }

        private static boolean isCancellation(Throwable e) {
            return e instanceof CancellationException
                    || (e instanceof CompletionException && e.getCause() instanceof CancellationException);
        }
    }

    private static final class StreamWatchdog implements AutoCloseable {
        private final InputStream body;
        private final TransferAbortHandle handle;
        private final Duration stallTimeout;
        private volatile long lastProgressNanos;
        private volatile ScheduledFuture<?> stallTask;
        private volatile ScheduledFuture<?> timeoutTask;
        private volatile ScheduledFuture<?> deadlineTask;
        private volatile Long deadlineNanos;
        private volatile ScheduledFuture<?> copyWindowTask;
        private volatile Long copyWindowNanos;
        private volatile Duration copyWindowTimeout;
        private volatile boolean stallAbort;
        private volatile boolean timeoutAbort;
        private volatile boolean deadlineAbort;
        private volatile boolean copyWindowAbort;
        private volatile boolean externalAbort;
        private volatile Call activeUpload;

        StreamWatchdog(InputStream body, TransferAbortHandle handle, Duration stallTimeout) {
            this.body = body;
            this.handle = handle;
            this.stallTimeout = stallTimeout;
            if (handle != null) {
                handle.wire(this::abortFromExternal);
            }
        }

        void armTimeout(Duration deadline) {
            timeoutTask = WATCHDOG_SCHEDULER.schedule(this::abortFromTimeout,
                    deadline.toNanos(), TimeUnit.NANOSECONDS);
        }

        void armStall() {
            ScheduledFuture<?> previous = stallTask;
            if (previous != null) previous.cancel(false);
            lastProgressNanos = System.nanoTime();
            stallTask = WATCHDOG_SCHEDULER.schedule(this::abortFromStall,
                    stallTimeout.toNanos(), TimeUnit.NANOSECONDS);
        }

        void armDeadline(LocalDateTime deadline) {
            if (deadline == null) return;
            long nanos = System.nanoTime() + Duration.between(LocalDateTime.now(), deadline).toNanos();
            deadlineNanos = nanos;
            deadlineTask = WATCHDOG_SCHEDULER.schedule(this::abortFromDeadline,
                    Math.max(0, nanos - System.nanoTime()), TimeUnit.NANOSECONDS);
        }

        void armCopyWindow(Duration window) {
            copyWindowTimeout = window;
            copyWindowNanos = System.nanoTime() + window.toNanos();
            copyWindowTask = WATCHDOG_SCHEDULER.schedule(this::abortFromCopyWindow,
                    window.toNanos(), TimeUnit.NANOSECONDS);
        }

        void disarmCopyWindow() {
            ScheduledFuture<?> task = copyWindowTask;
            if (task != null) task.cancel(false);
        }

        void disarmStall() {
            ScheduledFuture<?> task = stallTask;
            if (task != null) task.cancel(false);
        }

        private void abortFromTimeout() {
            timeoutAbort = true;
            closeBodyQuietly();
        }

        private void abortFromStall() {
            long idleNanos = System.nanoTime() - lastProgressNanos;
            if (idleNanos < stallTimeout.toNanos()) {
                stallTask = WATCHDOG_SCHEDULER.schedule(this::abortFromStall,
                        stallTimeout.toNanos() - idleNanos, TimeUnit.NANOSECONDS);
                return;
            }
            stallAbort = true;
            closeBodyQuietly();
        }

        private void abortFromDeadline() {
            deadlineAbort = true;
            Call upload = activeUpload;
            if (upload != null) upload.cancel();
            closeBodyQuietly();
        }

        private void abortFromCopyWindow() {
            copyWindowAbort = true;
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
            }
        }

        String externalReason() {
            return handle != null ? handle.reason() : null;
        }

        void progress() {
            lastProgressNanos = System.nanoTime();
            Long deadline = deadlineNanos;
            if (deadline != null && System.nanoTime() >= deadline) {
                deadlineAbort = true;
                throw new TaskDeadlineAbortException();
            }
            Long copyEnd = copyWindowNanos;
            if (copyEnd != null && System.nanoTime() >= copyEnd) {
                copyWindowAbort = true;
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频下载超时（超过 " + describeDuration(copyWindowTimeout) + "）");
            }
        }

        RuntimeException translateReadFailure(IOException e, Duration errorBodyTimeout) {
            if (externalAbort) {
                return new TransferAbortedException(externalReason());
            }
            if (deadlineAbort) {
                return new TaskDeadlineAbortException(e);
            }
            if (stallAbort) {
                return new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频下载停流（连续 " + describeDuration(stallTimeout) + " 无进度）", e);
            }
            if (copyWindowAbort) {
                return new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频下载超时（超过 " + describeDuration(copyWindowTimeout) + "）", e);
            }
            if (timeoutAbort) {
                return new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "错误响应正文读取超时（超过 " + describeDuration(errorBodyTimeout) + "）", e);
            }
            return new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    "生成视频下载失败: " + e.getMessage(), e);
        }

        void requireNotAborted() {
            if (externalAbort) throw new TransferAbortedException(externalReason());
            if (deadlineAbort) throw new TaskDeadlineAbortException();
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
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频转存网络失败", e);
            } finally {
                activeUpload = null;
            }
        }

        @Override
        public void close() {
            disarmStall();
            disarmCopyWindow();
            ScheduledFuture<?> timeout = timeoutTask;
            if (timeout != null) timeout.cancel(false);
            ScheduledFuture<?> deadline = deadlineTask;
            if (deadline != null) deadline.cancel(false);
            if (handle != null) handle.unwire();
        }
    }

    private static String describeDuration(Duration d) {
        return d.toMillis() >= 60_000 ? d.toMinutes() + " 分钟" : d.toMillis() + "ms";
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
