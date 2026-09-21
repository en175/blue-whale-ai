package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoProviderError;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.ObjectMetaRequestOptions;
import com.volcengine.tos.model.object.PutObjectACLInput;
import com.volcengine.tos.model.object.PutObjectInput;
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
     * 会把 worker 线程挂死（字节数组路径无此缺口——整段读取受 60s 全交换超时兜）；同时给
     * 1GiB 级结果留出 ≥1.7MB/s 的可用带宽。
     */
    private static final Duration STREAM_COPY_DEADLINE = Duration.ofMinutes(10);

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
        Path tempFile = null;
        try {
            tempFile = Files.createTempFile("video-relay-", ".part");

            // 1. 下载到临时文件（响应头等待走 60s，body 段走兜底时限 + 上限边读边判）
            long size;
            String mime;
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(sourceUrl))
                    .timeout(STREAM_HEADER_TIMEOUT)
                    .GET()
                    .build();
            HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            mime = contentType != null ? contentType.split(";", 2)[0].trim() : "video/mp4";
            try (InputStream body = resp.body()) {
                if (resp.statusCode() >= 400) {
                    String errBody = new String(body.readNBytes(4096), java.nio.charset.StandardCharsets.UTF_8);
                    String truncated = errBody.length() > 300 ? errBody.substring(0, 300) + "…" : errBody;
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                            "生成视频下载失败: HTTP " + resp.statusCode() + " body=" + truncated);
                }
                // 2. 校验 mime 在校验体之前（不是视频就不必落盘）
                if (!mime.startsWith("video/")) {
                    throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成结果不是视频");
                }
                size = copyToFile(body, tempFile, maxBytes, sourceUrl);
            }
            if (size == 0) {
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED, "生成视频为空");
            }
            String md5 = ContentDigest.md5Hex(tempFile);

            // 3. 上传（与字节数组路径同 key 格式、同 ACL）
            String extension = videoExtension(mime);
            String uuid = UUID.randomUUID().toString().replace("-", "");
            String storageKey = "generated/" + userId + "/video/" + uuid + "." + extension;
            try (InputStream fileIn = Files.newInputStream(tempFile)) {
                ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                        .setHeaders(Map.of("Content-Type", mime));
                PutObjectInput putInput = new PutObjectInput()
                        .setBucket(bucket)
                        .setKey(storageKey)
                        .setContent(fileIn)
                        .setContentLength(size)
                        .setOptions(options);
                client.putObject(putInput);
            } catch (Exception e) {
                throw new VideoProviderError(GenerationError.ERROR_PROVIDER_FAILED,
                        "生成视频转存失败: " + e.getMessage(), e);
            }

            PutObjectACLInput aclInput = new PutObjectACLInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setAcl(ACLType.ACL_PUBLIC_READ);
            client.putObjectAcl(aclInput);

            log.info("流式转存完成 storageKey={} size={} mime={}", storageKey, size, mime);
            String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
            return new StoredVideo(publicUrl, storageKey, mime, size, md5);
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

    /** 分块落盘：边读边判上限与兜底时限（上限语义同字节数组路径——等于上限通过）。 */
    private long copyToFile(InputStream in, Path target, long maxBytes, String sourceUrl)
            throws IOException {
        long deadlineNanos = System.nanoTime() + STREAM_COPY_DEADLINE.toNanos();
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
                            "生成视频下载超时（超过 " + STREAM_COPY_DEADLINE.toMinutes() + " 分钟）");
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

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
