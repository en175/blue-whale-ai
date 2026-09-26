package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoProviderError;
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
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
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
     * 故此值不约束大文件下载本身，body 段由停流超时（五参，{@link #STREAM_STALL_TIMEOUT}）
     * 或 copyWindow 固定窗（四参，{@link #STREAM_COPY_DEADLINE}）兜底；等待期内外部中止与
     * 五参任务截止经 {@link HeaderWait} 可立即取消请求，不等满本超时。
     */
    private static final Duration STREAM_HEADER_TIMEOUT = Duration.ofSeconds(60);

    /**
     * 停流超时 60s（IKILVH）：以「上次有进度」为基准，连续 60 秒无任何字节到达即中止——与
     * 响应头等待 60s（{@link #STREAM_HEADER_TIMEOUT}）同口径（对端已连上，60s 不吐一个字节
     * 即判停流；正常慢传输只要持续有字节就不会触发）。在五参入口（IKILVH 新模型）取代旧的
     * 固定 10 分钟总时限：10 GiB 上限下总时限要求 ≥17.1MiB/s 才能在窗内完成，合法慢传输会被
     * 误杀；新模型只拦「完全无进度」，持续有字节的传输不限总时长，改由调用方注入的任务截止
     * 时间（{@link #persistStreaming(String, String, long, TransferAbortHandle, Instant)}）与
     * {@code maxBytes} 容量上限分别限界。受控测试（TosVideoMediaRelayTest 慢流用例注入
     * 缩比参数）实测持续 ~0.6MiB/s 且总时长 2 倍于旧时限缩比值仍能完成；线上能否在任务
     * 截止时间内完成 10 GiB 取决于实际吞吐（10GiB@2MiB/s ≈ 85 分钟），本类不对未实测的
     * 线上速率做任何「任意速率均可完成」的承诺。
     */
    private static final Duration STREAM_STALL_TIMEOUT = Duration.ofSeconds(60);

    /**
     * 四参兼容入口的下载正文段总窗兜底 10 分钟（IKILU5 恢复、IKIN01 修正口径）：完整时限
     * 口径见四参入口
     * {@link #persistStreaming(String, String, long, TransferAbortHandle)} javadoc；
     * 只有五参入口用调用方任务截止时间替代兜底。
     */
    private static final Duration STREAM_COPY_DEADLINE = Duration.ofMinutes(10);

    /**
     * 错误响应正文读取截止 60s（IKHSFC）：错误体至多读 4096 字节，正常毫秒级完成；此前
     * {@code readNBytes} 无任何约束，错误响应停流同样挂死工作线程，与正文停流同口径由看门狗中止。
     */
    private static final Duration STREAM_ERROR_BODY_TIMEOUT = Duration.ofSeconds(60);

    /**
     * 任务截止中止的统一文案（HeaderWait / 看门狗四处抛出，文案不变）：IKIN90 起 catch 清理
     * 据此判别「截止口径的失败」——截止以 {@link VideoProviderError}（普通失败口径）抛出，
     * 无法按异常类型与停流 / copyWindow / 网络失败区分，文案是唯一稳定判别依据。
     */
    static final String TASK_DEADLINE_ABORT_MESSAGE = "任务执行截止时间已到，中止结果转存";

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
     * <p>
     * 本三参重载为无中止源兼容入口：等价四参传 null 句柄，时限口径见四参入口
     * {@link #persistStreaming(String, String, long, TransferAbortHandle)} javadoc。
     * 测试桩与跨端验收仍在使用。
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
     * 流式转存（带外部中止句柄，兼容入口）：句柄触发（如 IKHSFD 的转存期租约心跳未命中）会
     * 主动中止正在进行的下载/上传，以 {@link TransferAbortedException} 退出——调用方据此静默
     * 放弃本 worker 的发布（任务已被接管），不落失败终态。句柄可为 null（无外部中止源）。
     * <p>
     * 时限口径（IKILU5 恢复、IKIN01 修正）：本入口保持 IKILVH 之前的旧语义——响应头等待
     * {@link #STREAM_HEADER_TIMEOUT} 60s 独立超时；下载正文段受 {@link #STREAM_COPY_DEADLINE}
     * 10 分钟固定窗约束（从正文开始读取时起算、进度不重置、正文结束即撤销）；上传段无时限；
     * 不布防停流规则（60s 停流只属五参模型，不对本入口外溢），供未迁移任务截止时间模型的
     * 旧调用方（VideoMatting 未传 {@code execution_deadline_at}）使用，行为与其改动前一致；
     * 需要停流 + 任务截止模型的调用方（AudioVideoMux）走五参。
     */
    public StoredVideo persistStreaming(String sourceUrl, String userId, long maxBytes,
                                        TransferAbortHandle abortHandle) {
        return persistStreamingInternal(sourceUrl, userId, maxBytes, abortHandle,
                null, STREAM_COPY_DEADLINE, null, STREAM_ERROR_BODY_TIMEOUT);
    }

    /**
     * 流式转存（带外部中止句柄 + 任务截止时间，IKILVH 新模型）：时限模型为「停流超时（默认
     * {@link #STREAM_STALL_TIMEOUT}，无进度才计时）+ 任务截止时间（到点即中止）+ 容量上限
     * （边读边判）」三限界，不再有固定总时限——持续有进度的慢传输不受总时长约束。调用方
     * （processor）把 {@code execution_deadline_at} 传入：截止从请求发起（响应头等待）到正文
     * 读取、上传全程约束，到点由 {@link HeaderWait} 取消请求 / {@link StreamWatchdog} 主动
     * close 响应流 / 取消上传，以「任务执行截止时间已到」的供应商错误退出（属普通
     * 失败口径，与停流、容量超限、外部中止的文案分别命名，运维可定位）。截止时间可为
     * null（无任务截止约束，此时无任何总时限兜底——四参兼容入口才有 10 分钟兜底）。
     */
    public StoredVideo persistStreaming(String sourceUrl, String userId, long maxBytes,
                                        TransferAbortHandle abortHandle, Instant taskDeadline) {
        return persistStreamingInternal(sourceUrl, userId, maxBytes, abortHandle, taskDeadline,
                null, STREAM_STALL_TIMEOUT, STREAM_ERROR_BODY_TIMEOUT);
    }

    /**
     * 全参内部版（IKHSFC 起可注入截止；IKILVH 起 {@code stallTimeout} 语义改为停流超时——
     * 以「上次有进度」为基准，测试用亚秒级值做确定性回归，不真等 60s；IKIN01 起增
     * {@code copyWindow} 下载正文段固定总窗，四参兼容入口注入 {@link #STREAM_COPY_DEADLINE}、
     * 五参传 null，窗语义细则见四参入口
     * {@link #persistStreaming(String, String, long, TransferAbortHandle)} javadoc。
     * {@code taskDeadline} 与 {@code stallTimeout} 均可为 null（四参旧口径两者皆 null）。
     */
    StoredVideo persistStreamingInternal(String sourceUrl, String userId, long maxBytes,
                                         TransferAbortHandle abortHandle, Instant taskDeadline,
                                         Duration copyWindow, Duration stallTimeout,
                                         Duration errorBodyTimeout) {
        Path tempFile = null;
        // 已向上游发起 PUT 的对象 key：中止/截止退出时对象可能已落地（body 发完、仅响应未回的
        // 窗口），无 Asset 引用即孤儿——catch 里 deleteObject 清理（幂等，未落地也不报错）。
        String uploadedKey = null;
        try {
            tempFile = Files.createTempFile("video-relay-", ".part");

            // 1. 下载到临时文件（响应头等待走 60s，同时经 HeaderWait 建立可取消的等待责任——
            //    中止信号先于响应头到达也能立即取消请求；错误体与正文段各自布防看门狗——停流时
            //    截止检查在阻塞 read 里走不到，必须由看门狗到点主动 close 响应流打断读取）
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
                // 2. 校验 mime 在校验体之前（不是视频就不必落盘）
                if (!mime.startsWith("video/")) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成结果不是视频");
                }
                // 停流超时只属五参模型（stallTimeout != null 才布防）：以「上次有进度」为基准
                // 计时（每块字节到达即重置）；任务截止时间全程布防（含上传段），到点由看门狗
                // 主动打断；copyWindow 是四参旧口径的下载正文段固定总窗（进度不重置、正文结束
                // 即撤销）——两套时限模型互斥，四参（copyWindow）与五参（stall + taskDeadline）
                // 各自独立布防。
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

                // 3. 同 key / mime / ACL；ACL 随 PUT 原子提交，避免上传后再发不可取消的 ACL 请求。
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
            // 外部中止（取消/失租/续租异常）或任务截止（IKIN90）且 PUT 已发起 → 清理可能已落地
            // 的未发布对象——转存未成功返回前对象无 Asset 引用，截止虽属普通失败口径，同样会
            // 留孤儿，与外部中止同等清理；清理失败只记日志，中止/截止路径主语义（及时退出、
            // 不发布、原异常照常上抛）不因清理失败而变。其余失败（停流 / copyWindow / 网络 /
            // HTTP 错误，含四参旧口径的全部失败形态）维持不清理的现状。
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

    /**
     * 分块落盘：边读边判上限（上限语义同字节数组路径——等于上限通过）；每块到达即向看门狗
     * 上报进度（重置停流基准；任务截止 / copyWindow 到点直接中止）。停流的阻塞中止由看门狗
     * 兜——read 返回后才发现停流是常态，阻塞中的打断只能靠看门狗 close 响应流。五参模型下
     * 持续有进度即不再有总时长约束（IKILVH：10 GiB 上限与固定总时限互斥，慢传输由任务截止
     * 时间限界）；四参的 copyWindow 固定窗不因进度重置（IKIN01 旧口径）。
     */
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

    /**
     * 截止口径失败的判别（IKIN90）：任务截止中止抛 {@link VideoProviderError}（普通失败口径），
     * 与停流 / copyWindow / 网络失败同类型，仅文案可稳定区分——命中即视为「转存未成功返回的
     * 已落地对象」，与外部中止同等清理。截止只可能由本类的截止布防（HeaderWait / 看门狗）
     * 抛出，其余入口不会产生此文案；四参兼容入口无截止布防，天然不触发。
     */
    private static boolean isTaskDeadlineAbort(RuntimeException e) {
        return e instanceof VideoProviderError && TASK_DEADLINE_ABORT_MESSAGE.equals(e.getMessage());
    }

    /**
     * 清理未发布 TOS 对象（IKILVH 建于中止路径，IKIN03 起供 processor 复用——转存已成功
     * 返回后的放弃/守卫拒绝/发布异常路径，正常 return 后 relay 内部不再触达；IKIN90 起任务
     * 截止未成功返回的已落地对象同走此清理）：deleteObject 幂等（对象未落地也不报错），失败
     * 仅记日志（含对象身份，可定位）。
     */
    public void deleteUnpublishedObject(String storageKey) {
        try {
            client.deleteObject(new DeleteObjectInput().setBucket(bucket).setKey(storageKey));
            log.info("转存中止后清理未发布 TOS 对象 storageKey={}", storageKey);
        } catch (Exception e) {
            log.warn("转存中止后清理未发布 TOS 对象失败 storageKey={} err={}", storageKey, e.getMessage());
        }
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
     * 传输中止句柄（IKHSFC 建通道，IKHSFD 消费，IKIN01 扩到响应头等待期）：调用方（如转存期
     * 租约心跳）在确认应放弃本次传输时 {@link #abort(String)}；传输内部接线后主动 close 响应
     * 流 / 取消上传 HTTP 请求 / 取消等待响应头期间的下载请求，以 {@link TransferAbortedException}
     * 退出。接线前触发同样生效（wire 时补触发）。
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
     * 响应头等待期的可取消等待责任（IKIN01）：发起供应商下载请求（sendAsync）的同时把外部
     * 中止句柄与任务截止接到 pending future 上——中止信号先于响应头到达也能立即取消请求，
     * 不必等到 60s 响应头超时。此前的实现只在拿到正文流后才接线（StreamWatchdog 构造），
     * send 阻塞窗口内句柄与截止均无法打断等待，取消/失租要挂到最多 60s 响应头超时且被误
     * 归因为普通下载失败。响应头正常返回后 StreamWatchdog 的 wire 覆盖本类 wire 的取消
     * 动作（watchdog 接管正文与上传段的中止）；异常退出时残留的取消动作指向已终结的
     * future（cancel 为 no-op），无害。JDK HttpClient 的 future cancel 会关闭底层连接，
     * 服务端可观察到请求真正停止。包级可见：测试直接构造 HeaderWait 钉裸取消归因路径
     * （不依赖 HttpClient 的取消到达形态）。
     */
    static final class HeaderWait {
        private final CompletableFuture<HttpResponse<InputStream>> pending;
        private final TransferAbortHandle handle;
        private volatile ScheduledFuture<?> deadlineTask;
        private volatile boolean deadlineAbort;

        HeaderWait(CompletableFuture<HttpResponse<InputStream>> pending,
                   TransferAbortHandle handle, Instant taskDeadline) {
            this.pending = pending;
            this.handle = handle;
            if (handle != null) {
                // wire 时若句柄已 abort 会补触发，立即取消请求（接线前触发的补偿通道）
                handle.wire(() -> pending.cancel(true));
            }
            if (taskDeadline != null) {
                deadlineTask = WATCHDOG_SCHEDULER.schedule(this::abortFromDeadline,
                        Math.max(0, Duration.between(Instant.now(), taskDeadline).toNanos()), TimeUnit.NANOSECONDS);
            }
        }

        private void abortFromDeadline() {
            deadlineAbort = true;
            pending.cancel(true);
        }

        /**
         * 等待响应头：取消类完成按「外部中止 → 任务截止」归因（与看门狗同优先级），其余包供应商
         * 错误。取消的到达形态两种都要接：裸 {@link CancellationException}（cancel 后 join 的
         * 规范行为，非实现细节保证）与 {@link CompletionException} 包装（当前 JDK HttpClient
         * sendAsync 实际路径）——只接后者会让裸抛路径的取消逃逸成未归因异常。
         */
        HttpResponse<InputStream> await() {
            try {
                return pending.join();
            } catch (CompletionException | CancellationException e) {
                if (isCancellation(e)) {
                    // 请求取消只来自本类的两个动作：外部中止（优先）或任务截止到点
                    if (handle != null && handle.aborted()) {
                        throw new TransferAbortedException(handle.reason());
                    }
                    if (deadlineAbort) {
                        throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                                TASK_DEADLINE_ABORT_MESSAGE);
                    }
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频下载已取消", e);
                }
                Throwable cause = e.getCause() == null ? e : e.getCause();
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频下载失败: " + cause.getMessage(), cause);
            } finally {
                // 响应头已到（或已失败）：等待期截止定时器职责终结，正文段由看门狗另行布防
                ScheduledFuture<?> task = deadlineTask;
                if (task != null) task.cancel(false);
            }
        }

        /** join 的取消到达形态判定：裸抛（cancel 后 join 的规范行为）或 CompletionException 包装。 */
        private static boolean isCancellation(Throwable e) {
            return e instanceof CancellationException
                    || (e instanceof CompletionException && e.getCause() instanceof CancellationException);
        }
    }

    /**
     * 传输看门狗（IKHSFC 建通道，IKILVH 扩时限模型，IKIN01 增 copyWindow）：停流超时（以
     * 「上次有进度」为基准，{@link #progress()} 重置）/ 任务截止时间 / 下载正文段固定总窗
     * （copyWindow，进度不重置）/ 错误体读取截止 / 外部句柄五类信号到点或触发时主动 close
     * 正在读取的响应流、取消进行中的上传，打断阻塞中的 read（JDK HttpClient 的响应流 close
     * 会让阻塞读抛 IOException——此前截止检查只在 read 返回后执行，停流时永远走不到，500ms
     * 仍阻塞的审查探针即此因）。读取侧 IOException 经 {@link #translateReadFailure} 归因
     * （外部中止 → 任务截止 → 停流 → copyWindow → 错误体截止 → 供应商错误，文案分别命名）；
     * 上传侧经逐请求 Call.cancel 取消、{@link #requireNotAborted()} 按「外部中止 → 任务截止」
     * 优先级归因（截止中止不得误报网络失败）。copyWindow 不进入上传段归因——四参旧口径下
     * 上传段无时限（任务截止与外部通道保持接通，copyWindow 定时器在正文结束即撤销）。每个
     * {@code persistStreamingInternal} 调用一个实例，try-with-resources 释放。
     */
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

        /** 布防错误体读取截止（一次性：错误体至多 4096 字节，毫秒级读完，无需进度重置）。 */
        void armTimeout(Duration deadline) {
            timeoutTask = WATCHDOG_SCHEDULER.schedule(this::abortFromTimeout,
                    deadline.toNanos(), TimeUnit.NANOSECONDS);
        }

        /** 布防停流超时（IKILVH）：基准 = 上次进度；有进度经 {@link #progress()} 重置定时。 */
        void armStall() {
            ScheduledFuture<?> previous = stallTask;
            if (previous != null) previous.cancel(false);
            lastProgressNanos = System.nanoTime();
            stallTask = WATCHDOG_SCHEDULER.schedule(this::abortFromStall,
                    stallTimeout.toNanos(), TimeUnit.NANOSECONDS);
        }

        /**
         * 布防任务截止时间（IKILVH）：null 不布防；全程保持布防（含上传段），到点 close
         * 响应流 / 取消上传。nanoTime 单调钟与墙钟截止换算只在布防时做一次。
         */
        void armDeadline(Instant deadline) {
            if (deadline == null) return;
            long nanos = System.nanoTime() + Duration.between(Instant.now(), deadline).toNanos();
            deadlineNanos = nanos;
            deadlineTask = WATCHDOG_SCHEDULER.schedule(this::abortFromDeadline,
                    Math.max(0, nanos - System.nanoTime()), TimeUnit.NANOSECONDS);
        }

        /**
         * 布防下载正文段固定总窗（IKIN01 四参旧口径）：从正文开始读取时起算，进度不重置
         * （与 {@link #armStall} 的进度基准模型互斥），正文结束即 {@link #disarmCopyWindow()}
         * 撤销——不约束上传段，到点也不取消上传（旧语义：copyDeadline 只关响应流）。
         */
        void armCopyWindow(Duration window) {
            copyWindowTimeout = window;
            copyWindowNanos = System.nanoTime() + window.toNanos();
            copyWindowTask = WATCHDOG_SCHEDULER.schedule(this::abortFromCopyWindow,
                    window.toNanos(), TimeUnit.NANOSECONDS);
        }

        /** 撤防正文段固定总窗（下载正文正常完成后；窗不延伸到上传段）。 */
        void disarmCopyWindow() {
            ScheduledFuture<?> task = copyWindowTask;
            if (task != null) task.cancel(false);
        }

        /** 撤防停流定时（下载正常完成后；任务截止与外部通道保持接通直到 {@link #close()}）。 */
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
                // 定时器触发与 progress() 重排之间的竞态兜底：进度未停够时限只重排剩余窗口
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
                // 对端已断/流已关：中止目的已达成
            }
        }

        String externalReason() {
            return handle != null ? handle.reason() : null;
        }

        /** 每块字节到达即调用：重置停流基准；任务截止 / copyWindow 到点直接抛（read 返回后无需等定时器）。 */
        void progress() {
            lastProgressNanos = System.nanoTime();
            Long deadline = deadlineNanos;
            if (deadline != null && System.nanoTime() >= deadline) {
                deadlineAbort = true;
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        TASK_DEADLINE_ABORT_MESSAGE);
            }
            Long copyEnd = copyWindowNanos;
            if (copyEnd != null && System.nanoTime() >= copyEnd) {
                copyWindowAbort = true;
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频下载超时（超过 " + describeDuration(copyWindowTimeout) + "）");
            }
        }

        /** 读取侧 IOException 归因：外部中止 → 任务截止 → 停流 → copyWindow → 错误体截止 → 其余包供应商错误。 */
        RuntimeException translateReadFailure(IOException e, Duration errorBodyTimeout) {
            if (externalAbort) {
                return new TransferAbortedException(externalReason());
            }
            if (deadlineAbort) {
                return new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        TASK_DEADLINE_ABORT_MESSAGE, e);
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

        /**
         * 非读取段的主动中止检查（上传前后 / IOException 归因）：优先级 externalAbort →
         * deadlineAbort → 通过。任务截止到点（IKILU5）与下载段 {@link #translateReadFailure}
         * 同口径抛「任务执行截止时间已到」——否则上传段的截止中止会被 {@link #upload} 的
         * IOException catch 误归因为「网络失败」。
         */
        void requireNotAborted() {
            if (externalAbort) throw new TransferAbortedException(externalReason());
            if (deadlineAbort) throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                    TASK_DEADLINE_ABORT_MESSAGE);
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
                // 先归因主动中止（外部句柄 / 任务截止到点，各自抛专属文案），才轮到网络失败——
                // 截止取消连接与真实网络故障同抛 IOException，顺序反了会把截止误报成网络失败。
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
            disarmStall();
            disarmCopyWindow();
            ScheduledFuture<?> timeout = timeoutTask;
            if (timeout != null) timeout.cancel(false);
            ScheduledFuture<?> deadline = deadlineTask;
            if (deadline != null) deadline.cancel(false);
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
