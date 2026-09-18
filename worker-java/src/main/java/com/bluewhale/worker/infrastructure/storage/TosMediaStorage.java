package com.bluewhale.worker.infrastructure.storage;

import com.bluewhale.worker.domain.error.MediaExtractError;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.TOSV2ClientBuilder;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.GetObjectV2Input;
import com.volcengine.tos.model.object.GetObjectV2Output;
import com.volcengine.tos.model.object.ObjectMetaRequestOptions;
import com.volcengine.tos.model.object.PutObjectACLInput;
import com.volcengine.tos.model.object.PutObjectInput;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

/**
 * TOS 媒体存储服务（tos-media-extract.ts + tos-storage.ts 移植）。
 * <p>
 * 配置：VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY / VOLC_TOS_ENDPOINT /
 * VOLC_TOS_BUCKET / VOLC_TOS_REGION（契约 §8：5 个全必需，缺一即硬失败）。
 * <p>
 * 无条件装配（ADR-0084 修正六）：启动即构造本 bean，5 个 env 缺一即抛错终止启动。
 * 视频路径不经本 bean（走 TosVideoMediaRelay，TOS 缺省 null 宽容降级）。
 * <p>
 * 偏差说明：TS 上传走预签名 PUT（prepareUpload → fetch PUT → makePublic），
 * Java 直走 SDK putObject + putObjectAcl（结果一致：对象在 TOS 中 public-read）。
 * 注释标注 {@code DEVIATION} 处。
 */
@Component
public class TosMediaStorage {

    private static final Logger log = LoggerFactory.getLogger(TosMediaStorage.class);

    /** 下载心跳间隔：必须小于任务租约（120s），否则长下载期间任务会被判定过期而可被抢走。 */
    static final long HEARTBEAT_INTERVAL_MS = 30_000;

    /** 下载缓冲：边读边写盘，避免整段视频驻留堆内存（上限 200MiB）。 */
    private static final int DOWNLOAD_BUFFER_BYTES = 64 * 1024;

    private final TOSV2 client;
    private final String bucket;
    private final String endpoint;

    /**
     * 从环境变量构建 TOS 客户端。
     * 5 个 env 全必需，缺一抛错（契约 §8：extract 硬失败「TOS configuration required for media extract」）。
     */
    public TosMediaStorage() {
        String accessKeyId = System.getenv("VOLC_ACCESS_KEY_ID");
        String secretAccessKey = System.getenv("VOLC_SECRET_ACCESS_KEY");
        String endpointEnv = System.getenv("VOLC_TOS_ENDPOINT");
        String bucketEnv = System.getenv("VOLC_TOS_BUCKET");
        String region = System.getenv("VOLC_TOS_REGION");

        if (isBlank(accessKeyId) || isBlank(secretAccessKey)
                || isBlank(endpointEnv) || isBlank(bucketEnv) || isBlank(region)) {
            throw new IllegalStateException("TOS configuration required for media extract");
        }

        // 去协议头和尾斜杠（tos-storage.ts:67-69 normalizeEndpoint）
        this.endpoint = endpointEnv.replaceFirst("^https?://", "").replaceFirst("/$", "");
        this.bucket = bucketEnv;

        this.client = new TOSV2ClientBuilder().build(
                region, this.endpoint, accessKeyId, secretAccessKey, TosTransportConfig.fromEnv());
    }

    /** 测试用构造器：注入 mock client。 */
    TosMediaStorage(TOSV2 client, String bucket, String endpoint) {
        this.client = client;
        this.bucket = bucket;
        this.endpoint = endpoint;
    }

    /**
     * 下载视频到临时文件（tos-media-extract.ts:17-58 移植）。
     * <p>
     * DEVIATION：TS 走公网 HTTP fetch（资产 public-read，无需签名），
     * Java 走 SDK getObject（结果一致：得到视频字节流写入本地文件）。
     * <p>
     * IKFS5W：读超时放宽到 5min 后，单次下载可能超过任务租约（120s）→ 任务可被抢走重跑。
     * 因此边写边按 {@link #HEARTBEAT_INTERVAL_MS} 触发心跳（调用方用它续租）。
     *
     * @param url        资产公网 URL（用于日志；实际走 SDK getObject）
     * @param storageKey 资产存储 key
     * @param outputPath 临时文件路径
     * @param maxBytes   大小上限
     * @throws MediaExtractError video_download_failed / video_too_large
     */
    public void download(String url, String storageKey, Path outputPath, long maxBytes) {
        download(url, storageKey, outputPath, maxBytes, null);
    }

    /** 带心跳的下载：{@code onHeartbeat} 每 {@link #HEARTBEAT_INTERVAL_MS} 至多触发一次（可空）。 */
    public void download(String url, String storageKey, Path outputPath, long maxBytes, Runnable onHeartbeat) {
        download(url, storageKey, outputPath, maxBytes, onHeartbeat, HEARTBEAT_INTERVAL_MS);
    }

    /** 测试注入口：心跳间隔可替换。 */
    void download(String url, String storageKey, Path outputPath, long maxBytes,
                  Runnable onHeartbeat, long heartbeatIntervalMs) {
        try {
            GetObjectV2Input input = new GetObjectV2Input()
                    .setBucket(bucket)
                    .setKey(storageKey);
            GetObjectV2Output output = client.getObject(input);

            long contentLength = output.getContentLength();
            if (contentLength > maxBytes) {
                output.close();
                throw new MediaExtractError(MediaExtractError.VIDEO_TOO_LARGE, "视频超过大小上限");
            }

            try (InputStream is = output.getContent();
                 OutputStream os = Files.newOutputStream(outputPath)) {
                byte[] buffer = new byte[DOWNLOAD_BUFFER_BYTES];
                long total = 0;
                long lastHeartbeatAt = System.currentTimeMillis();
                int read;
                while ((read = is.read(buffer)) != -1) {
                    os.write(buffer, 0, read);
                    total += read;
                    if (total > maxBytes) {
                        throw new MediaExtractError(MediaExtractError.VIDEO_TOO_LARGE, "视频超过大小上限");
                    }
                    if (onHeartbeat != null
                            && System.currentTimeMillis() - lastHeartbeatAt >= heartbeatIntervalMs) {
                        lastHeartbeatAt = System.currentTimeMillis();
                        onHeartbeat.run();
                    }
                }
            }
        } catch (MediaExtractError e) {
            throw e;
        } catch (Exception e) {
            throw new MediaExtractError(
                    MediaExtractError.VIDEO_DOWNLOAD_FAILED,
                    "TOS 视频下载失败: " + e.getMessage(),
                    e
            );
        }
    }

    /**
     * 上传 mp3 到 TOS 并设 public-read（tos-media-extract.ts:62-94 移植）。
     * <p>
     * key 格式：{@code media-extract/audio/{uuid去横线}.mp3}（tos-storage.ts:182-183）。
     * 公开 URL：{@code https://{bucket}.{endpoint}/{key}}（tos-storage.ts:193）。
     *
     * @param filePath 本地 mp3 文件路径
     * @param mime     MIME 类型（恒 "audio/mpeg"）
     * @return 上传结果（url / storageKey / mime / size / md5）
     * @throws MediaExtractError upload_failed
     */
    public UploadResult upload(Path filePath, String mime) {
        try {
            byte[] bytes = Files.readAllBytes(filePath);

            // key 生成（tos-storage.ts:182-183：keyPrefix/type/uuid.ext）
            String uuid = UUID.randomUUID().toString().replace("-", "");
            String storageKey = "media-extract/audio/" + uuid + ".mp3";

            // DEVIATION：TS 走预签名 PUT（prepareUpload → fetch PUT），
            // Java 直走 SDK putObject（结果一致：对象写入 TOS）。
            // Content-Type 通过 ObjectMetaRequestOptions headers 设置。
            ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                    .setHeaders(Map.of("Content-Type", mime));
            PutObjectInput putInput = new PutObjectInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setContent(new ByteArrayInputStream(bytes))
                    .setContentLength((long) bytes.length)
                    .setOptions(options);
            client.putObject(putInput);

            // 设 public-read（tos-storage.ts:85 makePublic → putObjectAcl public-read）
            PutObjectACLInput aclInput = new PutObjectACLInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setAcl(ACLType.ACL_PUBLIC_READ);
            client.putObjectAcl(aclInput);

            String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
            return new UploadResult(publicUrl, storageKey, mime, bytes.length, ContentDigest.md5Hex(bytes));
        } catch (MediaExtractError e) {
            throw e;
        } catch (Exception e) {
            throw new MediaExtractError(
                    MediaExtractError.UPLOAD_FAILED,
                    "TOS 音频上传失败: " + e.getMessage(),
                    e
            );
        }
    }

    /**
     * 上传字节到 TOS（blade-② audio data-direct 路径）。
     * <p>
     * key 格式：{@code uploads/audio/{uuid去横线}.mp3}（tos-storage.ts:182-183，prefix 为空时用 uploads）。
     *
     * @param data 音频字节（base64 解码后）
     * @param mime MIME 类型（恒 "audio/mpeg"）
     * @return 上传结果
     * @throws MediaExtractError upload_failed
     */
    public UploadResult uploadBytes(byte[] data, String mime) {
        try {
            String uuid = java.util.UUID.randomUUID().toString().replace("-", "");
            String storageKey = "uploads/audio/" + uuid + ".mp3";

            ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                    .setHeaders(java.util.Map.of("Content-Type", mime));
            PutObjectInput putInput = new PutObjectInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setContent(new ByteArrayInputStream(data))
                    .setContentLength((long) data.length)
                    .setOptions(options);
            client.putObject(putInput);

            PutObjectACLInput aclInput = new PutObjectACLInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setAcl(ACLType.ACL_PUBLIC_READ);
            client.putObjectAcl(aclInput);

            String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
            return new UploadResult(publicUrl, storageKey, mime, data.length, ContentDigest.md5Hex(data));
        } catch (Exception e) {
            throw new MediaExtractError(
                    MediaExtractError.UPLOAD_FAILED,
                    "TOS 音频上传失败: " + e.getMessage(), e);
        }
    }

    /**
     * 上传图片字节到 TOS（blade-③ image persistProviderMedia 路径）。
     * <p>
     * key 格式：{@code uploads/{userId}/image/{uuid去横线}.{ext}}（tos-storage.ts:182-183，
     * 契约 §8：无前缀 uploads/{userId}/{type}/...）。
     * <p>
     * 扩展名按 MIME 映射（§8）：image/png→png, image/jpeg→jpg, image/gif→gif,
     * image/webp→webp, 未知回退 jpg。
     *
     * @param data   图片字节
     * @param mime   MIME 类型
     * @return 上传结果
     */
    public UploadResult uploadImageBytes(byte[] data, String mime) {
        return uploadImageBytes(data, mime, "0");
    }

    /**
     * 上传图片字节到 TOS（带 userId，契约 §8 key 格式）。
     */
    public UploadResult uploadImageBytes(byte[] data, String mime, String userId) {
        try {
            String ext = mimeToExt(mime);
            String uuid = java.util.UUID.randomUUID().toString().replace("-", "");
            String storageKey = "uploads/" + userId + "/image/" + uuid + "." + ext;

            ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                    .setHeaders(java.util.Map.of("Content-Type", mime));
            PutObjectInput putInput = new PutObjectInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setContent(new ByteArrayInputStream(data))
                    .setContentLength((long) data.length)
                    .setOptions(options);
            client.putObject(putInput);

            PutObjectACLInput aclInput = new PutObjectACLInput()
                    .setBucket(bucket)
                    .setKey(storageKey)
                    .setAcl(ACLType.ACL_PUBLIC_READ);
            client.putObjectAcl(aclInput);

            String publicUrl = "https://" + bucket + "." + endpoint + "/" + storageKey;
            return new UploadResult(publicUrl, storageKey, mime, data.length, ContentDigest.md5Hex(data));
        } catch (Exception e) {
            throw new MediaExtractError(
                    MediaExtractError.UPLOAD_FAILED,
                    "TOS 图片上传失败: " + e.getMessage(), e);
        }
    }

    /**
     * MIME → 扩展名映射（契约 §8：未知 image 回退 jpg）。
     */
    private static String mimeToExt(String mime) {
        if (mime == null) return "jpg";
        return switch (mime.toLowerCase()) {
            case "image/png" -> "png";
            case "image/jpeg", "image/jpg" -> "jpg";
            case "image/gif" -> "gif";
            case "image/webp" -> "webp";
            case "image/bmp" -> "bmp";
            default -> "jpg";
        };
    }

    /** 上传结果（形状对齐 tos-media-extract.ts:86-91；IKGS73 起多带 {@code md5}，故非逐字）。
     *  {@code md5}（IKGS73）：上传字节的 MD5，32 位小写 hex，供 {@code assets.md5} 落库。
     *  算法与编码统一走 {@link ContentDigest}——与视频转存出口共用同一份实现。 */
    public record UploadResult(String url, String storageKey, String mime, long size, String md5) {}

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
