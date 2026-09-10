package com.bluewhale.worker.infrastructure.storage;

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
 * 视频媒体转存（tos-video-media-relay.ts 逐字移植）。
 * <p>
 * 转存流程：fetch 源 URL → 校验 video/ mime → TOS PUT → putObjectAcl public-read。
 * <p>
 * key 格式：{@code generated/{userId}/video/{uuid去横线}.{ext}}（:96）。
 * 扩展名映射（:150-154 videoExtension）：webm → webm, quicktime → mov, 其余 → mp4。
 * <p>
 * 上限：200MB（:76 maxVideoBytes）。
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
                throw new RuntimeException("生成视频下载失败: " + resp.statusCode());
            }
            bytes = resp.body();
            String contentType = resp.headers().firstValue("content-type").orElse(null);
            mime = contentType != null
                    ? contentType.split(";", 2)[0].trim()
                    : "video/mp4";
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("生成视频下载失败: " + e.getMessage(), e);
        }

        // 2. 校验（:88-93）
        if (!mime.startsWith("video/")) {
            throw new RuntimeException("生成结果不是视频");
        }
        if (bytes.length == 0) {
            throw new RuntimeException("生成视频为空");
        }
        if (bytes.length > MAX_VIDEO_BYTES) {
            throw new RuntimeException("生成视频超过转存上限");
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
            throw new RuntimeException("生成视频转存失败: " + e.getMessage(), e);
        }

        String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
        return new StoredVideo(publicUrl, storageKey, mime, (long) bytes.length);
    }

    /**
     * 视频扩展名映射（tos-video-media-relay.ts:150-154 videoExtension）。
     */
    static String videoExtension(String mime) {
        if ("video/webm".equals(mime)) return "webm";
        if ("video/quicktime".equals(mime)) return "mov";
        return "mp4";
    }

    /** 转存结果（video-job-runner.ts:89-94 StoredVideo 逐字移植）。 */
    public record StoredVideo(String url, String storageKey, String mime, Long size) {}

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
