package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.error.MediaExtractError;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.ObjectMetaRequestOptions;
import com.volcengine.tos.model.object.PutObjectACLInput;
import com.volcengine.tos.model.object.PutObjectInput;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
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
import java.util.concurrent.TimeUnit;

/**
 * 音频媒体转存（迁移契约 §18 / IKH28W；以 {@link TosVideoMediaRelay} 为模板的 audio/ 变体）。
 * <p>
 * 为什么不复用视频件：视频 relay 的 mime 校验是 {@code video/} 前缀专用（:122），音频产物
 * 会被直接拒收——按「不改动视频 relay 既有行为」口径单独成件，结构逐字对齐视频先例：
 * fetch 源 URL → 校验产物像音频 → TOS PUT → putObjectAcl public-read。
 * <p>
 * key 格式：{@code generated/{userId}/audio/{uuid去横线}.{ext}}（视频先例
 * {@code generated/{userId}/video/...} 的音频同构位；区别于 ffmpeg 本地链路的
 * {@code media-extract/audio/{uuid}.mp3}——本件只承接火山异步产物转存）。
 * <b>扩展名与 mime 都以任务所选 output_format 为单源</b>（m4a / mp3 / ogg / flac / wav，
 * MediaExtractContract 五值枚举），不从响应 content-type 推——官方/CDN 常把 m4a 标成
 * {@code audio/mpeg} 或 {@code video/mp4}，抄头会导致前端下载扩展名错成 .mp3/.mp4
 * （IKHCW9）。旧本地链路 TosMediaStorage.upload 恒 .mp3 硬编码即此问题的 ffmpeg
 * 单格式特例，本件随任务格式扩展。
 * <p>
 * 大产物先流式落临时文件，再用文件流上传；不会把供应商产物整份载入堆，也不将输入建议大小
 * 擅自变成用户可见的硬上限（异常流的磁盘防护上限见 {@link #MAX_RELAY_BYTES}）。磁盘、下载
 * 或 TOS 上传失败均由调用方记录失败终态。
 */
public class TosAudioMediaRelay {

    private static final Logger log = LoggerFactory.getLogger(TosAudioMediaRelay.class);

    private static final ScheduledExecutorService DOWNLOAD_WATCHDOG = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "audio-relay-watchdog");
        thread.setDaemon(true);
        return thread;
    });

    /** 转存 key 的产物目录段（视频先例 "video" 的音频同构位）。 */
    static final String KEY_TYPE_SEGMENT = "audio";

    /**
     * 转存字节上限（10 GiB，对齐供应商「单文件不建议超过 10 GB」）。这是防异常/劫持上游在
     * 6h watchdog 窗口内无限流写满 worker 磁盘的内部护栏，不是用户可见的产品容量限制——
     * 后者按 IKI5ZC Further Notes 须先修订规格与 UI 才能引入。IKI696 移除旧 1 GiB 上限
     * 是为放行超大合法产物（>1 GiB 用例见 TosAudioMediaRelayMixTest），本护栏不收紧该语义。
     */
    static final long MAX_RELAY_BYTES = 10L << 30;

    private final TOSV2 client;
    private final String bucket;
    private final String endpoint;
    private final HttpClient httpClient;
    private final long maxRelayBytes;

    public TosAudioMediaRelay(TOSV2 client, String bucket, String endpoint) {
        this(client, bucket, endpoint, MAX_RELAY_BYTES);
    }

    /** 测试注入小上限用；生产路径走 {@link #TosAudioMediaRelay(TOSV2, String, String)}。 */
    TosAudioMediaRelay(TOSV2 client, String bucket, String endpoint, long maxRelayBytes) {
        this.client = client;
        this.bucket = bucket;
        this.endpoint = endpoint;
        this.maxRelayBytes = maxRelayBytes;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    /**
     * 从环境变量构建 TOS 音频转存。
     * 5 个 env 全必需（与 TosVideoMediaRelay / TosMediaStorage 同源）；缺一返回 null
     * （processor 判 null → 终态失败：火山结果 URL 仅 24h 有效，强依赖不降级直存）。
     */
    public static TosAudioMediaRelay fromEnv() {
        String accessKeyId = System.getenv("VOLC_ACCESS_KEY_ID");
        String secretAccessKey = System.getenv("VOLC_SECRET_ACCESS_KEY");
        String endpointEnv = System.getenv("VOLC_TOS_ENDPOINT");
        String bucketEnv = System.getenv("VOLC_TOS_BUCKET");
        String region = System.getenv("VOLC_TOS_REGION");

        if (isBlank(accessKeyId) || isBlank(secretAccessKey)
                || isBlank(endpointEnv) || isBlank(bucketEnv) || isBlank(region)) {
            return null; // TOS 未配置 → 调用方按强依赖口径终态失败（不降级直存）
        }

        String normalizedEndpoint = endpointEnv.replaceFirst("^https?://", "").replaceFirst("/$", "");
        TOSV2 client = new TOSV2ClientBuilder().build(region, normalizedEndpoint, accessKeyId, secretAccessKey);
        return new TosAudioMediaRelay(client, bucketEnv, normalizedEndpoint);
    }

    /**
     * 转存音频：流式下载 → 按 output_format 落 mime →
     * 弱校验响应头像音频（m4a 允许被标成 video/mp4）→ PUT → makePublic。
     * <p>
     * 错误统一抛 {@link MediaExtractError}（1044 兜底码由 processor 归并，§18.4 第三类：
     * 转存失败归并工具兜底码）。
     *
     * @param sourceUrl     火山 result.audio_url（24h 有效临时链接，调用方须立即转存）
     * @param userId        归属用户（key 路径用）
     * @param outputFormat  任务所选输出格式（扩展名与 mime 的单源，五值枚举）
     * @return 转存结果
     */
    public StoredAudio persist(String sourceUrl, String userId, String outputFormat) {
        Path tempFile = null;
        try {
            tempFile = Files.createTempFile("audio-relay-", ".part");
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(sourceUrl))
                    .timeout(Duration.ofSeconds(60))
                    .GET()
                    .build();
            HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
            String reportedType = resp.headers().firstValue("content-type")
                    .map(value -> value.split(";", 2)[0].trim()).orElse("");
            long size;
            try (InputStream body = resp.body()) {
                var timeout = DOWNLOAD_WATCHDOG.schedule(() -> {
                    try { body.close(); } catch (IOException ignored) { }
                }, 6, TimeUnit.HOURS);
                try {
                    if (resp.statusCode() >= 400) {
                        String errBody = new String(body.readNBytes(301), java.nio.charset.StandardCharsets.UTF_8);
                        String truncated = errBody.length() > 300 ? errBody.substring(0, 300) + "…" : errBody;
                        throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                                "生成音频下载失败: HTTP " + resp.statusCode() + " body=" + truncated);
                    }
                    String reported = reportedType.toLowerCase();
                    if (!reported.isEmpty() && !reported.startsWith("audio/")
                            && !("m4a".equals(outputFormat) && "video/mp4".equals(reported))) {
                        throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                                "生成结果不是音频");
                    }
                    size = copyWithLimit(body, tempFile);
                } finally {
                    timeout.cancel(false);
                }
            }
            if (size == 0) {
                throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED, "生成音频为空");
            }
            String mime = mimeForOutputFormat(outputFormat);
            String storageKey = "generated/" + userId + "/" + KEY_TYPE_SEGMENT + "/"
                    + UUID.randomUUID().toString().replace("-", "") + "." + outputFormat;
            String md5 = ContentDigest.md5Hex(tempFile);
            try (InputStream upload = Files.newInputStream(tempFile)) {
                ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                        .setHeaders(Map.of("Content-Type", mime));
                client.putObject(new PutObjectInput()
                        .setBucket(bucket).setKey(storageKey).setContent(upload)
                        .setContentLength(size).setOptions(options));
                client.putObjectAcl(new PutObjectACLInput()
                        .setBucket(bucket).setKey(storageKey).setAcl(ACLType.ACL_PUBLIC_READ));
            } catch (Exception e) {
                throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                        "生成音频转存失败: " + e.getMessage(), e);
            }
            String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
            return new StoredAudio(publicUrl, storageKey, mime, size, md5);
        } catch (MediaExtractError e) {
            throw e;
        } catch (Exception e) {
            throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                    "生成音频下载失败: " + e.getMessage(), e);
        } finally {
            if (tempFile != null) {
                try { Files.deleteIfExists(tempFile); }
                catch (IOException e) { log.warn("音频转存临时文件清理失败: {}", e.getMessage()); }
            }
        }
    }

    /** 按任务所选格式推导 mime（扩展名与 TOS Content-Type / assets.mime 的单源；
     *  aac 供 vocal_split 五值枚举——该工具枚举含 aac 而 media_extract 无，
     *  回退表补 aac 分支对既有调用无影响）。 */
    static String mimeForOutputFormat(String outputFormat) {
        return switch (outputFormat) {
            case "aac" -> "audio/aac";
            case "m4a" -> "audio/mp4";
            case "ogg" -> "audio/ogg";
            case "flac" -> "audio/flac";
            case "wav" -> "audio/wav";
            default -> "audio/mpeg";
        };
    }

    /** 流式落盘并累计字节数，超过 {@code maxRelayBytes} 立即中止（超限写满磁盘的护栏）。 */
    private long copyWithLimit(InputStream body, Path target) throws IOException {
        try (var out = Files.newOutputStream(target,
                java.nio.file.StandardOpenOption.CREATE,
                java.nio.file.StandardOpenOption.TRUNCATE_EXISTING,
                java.nio.file.StandardOpenOption.WRITE)) {
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = body.read(buffer)) != -1) {
                total += read;
                if (total > maxRelayBytes) {
                    throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                            "生成音频超过转存上限 " + (maxRelayBytes >> 30) + " GiB，已中止下载（收到 "
                                    + total + " 字节）");
                }
                out.write(buffer, 0, read);
            }
            return total;
        }
    }

    /** 转存结果（视频先例 StoredVideo 形态的音频同构，md5 供 assets.md5 落库 IKGS73）。 */
    public record StoredAudio(String url, String storageKey, String mime, Long size, String md5) {}

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
