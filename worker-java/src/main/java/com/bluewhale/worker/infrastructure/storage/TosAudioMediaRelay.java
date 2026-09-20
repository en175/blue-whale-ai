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

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

/**
 * 音频媒体转存（迁移契约 §18 / IKH28W；以 {@link TosVideoMediaRelay} 为模板的 audio/ 变体）。
 * <p>
 * 为什么不复用视频件：视频 relay 的 mime 校验是 {@code video/} 前缀专用（:122），音频产物
 * 会被直接拒收——按「不改动视频 relay 既有行为」口径单独成件，结构逐字对齐视频先例：
 * fetch 源 URL → 校验 {@code audio/} mime → TOS PUT → putObjectAcl public-read。
 * <p>
 * key 格式：{@code generated/{userId}/audio/{uuid去横线}.{ext}}（视频先例
 * {@code generated/{userId}/video/...} 的音频同构位；区别于 ffmpeg 本地链路的
 * {@code media-extract/audio/{uuid}.mp3}——本件只承接火山异步产物转存）。
 * <b>扩展名 = 任务所选 output_format</b>（m4a / mp3 / ogg / flac / wav，MediaExtractContract
 * 五值枚举），不从响应 content-type 推——官方产物格式由提交参数决定，防止 CDN content-type
 * 漂移导致后缀与内容不符（旧本地链路 TosMediaStorage.upload 恒 .mp3 硬编码即此问题的
 * ffmpeg 单格式特例，本件随任务格式扩展）。
 * <p>
 * mime 从响应 Content-Type 取（分号参数剥离；缺失回退按 output_format 推导），落
 * {@code assets.mime} 供前端播放器判型。
 * <p>
 * 大小上限 1GiB（全内存 byte[] 转存故仍需硬上限）：火山输入建议 ≤10GB（官方 PDF），其无损
 * wav 音轨理论上限 ≈600MB，1GiB 覆盖最坏情况（视频先例 200MB 对应其 200MB 输入口径）。
 */
public class TosAudioMediaRelay {

    private static final Logger log = LoggerFactory.getLogger(TosAudioMediaRelay.class);

    /** 音频转存大小上限 1GiB（见类注释口径）。 */
    static final long MAX_AUDIO_BYTES = 1L << 30;

    /** 转存 key 的产物目录段（视频先例 "video" 的音频同构位）。 */
    static final String KEY_TYPE_SEGMENT = "audio";

    private final TOSV2 client;
    private final String bucket;
    private final String endpoint;
    private final HttpClient httpClient;

    public TosAudioMediaRelay(TOSV2 client, String bucket, String endpoint) {
        this.client = client;
        this.bucket = bucket;
        this.endpoint = endpoint;
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
     * 转存音频（视频先例 persist 同构）：fetch → audio/ 校验 → PUT → makePublic。
     * <p>
     * 错误统一抛 {@link MediaExtractError}（1044 兜底码由 processor 归并，§18.4 第三类：
     * 转存失败归并工具兜底码）。
     *
     * @param sourceUrl     火山 result.audio_url（24h 有效临时链接，调用方须立即转存）
     * @param userId        归属用户（key 路径用）
     * @param outputFormat  任务所选输出格式（扩展名与回退 mime 的单源，五值枚举）
     * @return 转存结果
     */
    public StoredAudio persist(String sourceUrl, String userId, String outputFormat) {
        // 1. fetch 源 URL（视频先例同款：60s 超时、followRedirects NORMAL）
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
                throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                        "生成音频下载失败: HTTP " + resp.statusCode() + " body=" + truncated);
            }
            bytes = resp.body();
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            mime = contentType != null
                    ? contentType.split(";", 2)[0].trim()
                    : defaultMime(outputFormat);
        } catch (MediaExtractError e) {
            throw e;
        } catch (Exception e) {
            throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                    "生成音频下载失败: " + e.getMessage(), e);
        }

        // 2. 校验（视频先例同构，mime 前缀换 audio/）
        if (!mime.startsWith("audio/")) {
            throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED, "生成结果不是音频");
        }
        if (bytes.length == 0) {
            throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED, "生成音频为空");
        }
        if (bytes.length > MAX_AUDIO_BYTES) {
            throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED, "生成音频超过转存上限");
        }

        // 3. 上传：key 后缀 = 任务所选 output_format（扩展名单源，见类注释）
        String uuid = UUID.randomUUID().toString().replace("-", "");
        String storageKey = "generated/" + userId + "/" + KEY_TYPE_SEGMENT + "/"
                + uuid + "." + outputFormat;

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

            // makePublic（视频先例同款）
            PutObjectACLInput aclInput = new PutObjectACLInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setAcl(ACLType.ACL_PUBLIC_READ);
            client.putObjectAcl(aclInput);
        } catch (Exception e) {
            throw new MediaExtractError(MediaExtractError.MEDIA_EXTRACT_PROVIDER_FAILED,
                    "生成音频转存失败: " + e.getMessage(), e);
        }

        String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
        return new StoredAudio(publicUrl, storageKey, mime, (long) bytes.length,
                ContentDigest.md5Hex(bytes));
    }

    /** 响应缺 Content-Type 时的回退 mime（按任务所选格式推导；aac 供 vocal_split 五值枚举——
     *  该工具枚举含 aac 而 media_extract 无，回退表补 aac 分支对既有调用无影响）。 */
    static String defaultMime(String outputFormat) {
        return switch (outputFormat) {
            case "aac" -> "audio/aac";
            case "m4a" -> "audio/mp4";
            case "ogg" -> "audio/ogg";
            case "flac" -> "audio/flac";
            case "wav" -> "audio/wav";
            default -> "audio/mpeg";
        };
    }

    /** 转存结果（视频先例 StoredVideo 形态的音频同构，md5 供 assets.md5 落库 IKGS73）。 */
    public record StoredAudio(String url, String storageKey, String mime, Long size, String md5) {}

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
