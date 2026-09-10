package com.bluewhale.worker.storage;

import com.bluewhale.worker.processor.MediaExtractError;
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
 * 偏差说明：TS 上传走预签名 PUT（prepareUpload → fetch PUT → makePublic），
 * Java 直走 SDK putObject + putObjectAcl（结果一致：对象在 TOS 中 public-read）。
 * 注释标注 {@code DEVIATION} 处。
 */
@Component
public class TosMediaService {

    private static final Logger log = LoggerFactory.getLogger(TosMediaService.class);

    private final TOSV2 client;
    private final String bucket;
    private final String endpoint;

    /**
     * 从环境变量构建 TOS 客户端。
     * 5 个 env 全必需，缺一抛错（契约 §8：extract 硬失败「TOS configuration required for media extract」）。
     */
    public TosMediaService() {
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

        this.client = new TOSV2ClientBuilder().build(region, this.endpoint, accessKeyId, secretAccessKey);
    }

    /** 测试用构造器：注入 mock client。 */
    TosMediaService(TOSV2 client, String bucket, String endpoint) {
        this.client = client;
        this.bucket = bucket;
        this.endpoint = endpoint;
    }

    /**
     * 下载视频到临时文件（tos-media-extract.ts:17-58 移植）。
     * <p>
     * DEVIATION：TS 走公网 HTTP fetch（资产 public-read，无需签名），
     * Java 走 SDK getObject（结果一致：得到视频字节流写入本地文件）。
     *
     * @param url        资产公网 URL（用于日志；实际走 SDK getObject）
     * @param storageKey 资产存储 key
     * @param outputPath 临时文件路径
     * @param maxBytes   大小上限
     * @throws MediaExtractError video_download_failed / video_too_large
     */
    public void download(String url, String storageKey, Path outputPath, long maxBytes) {
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

            try (InputStream is = output.getContent()) {
                byte[] bytes = is.readAllBytes();
                if (bytes.length > maxBytes) {
                    throw new MediaExtractError(MediaExtractError.VIDEO_TOO_LARGE, "视频超过大小上限");
                }
                Files.write(outputPath, bytes);
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
     * @return 上传结果（url / storageKey / mime / size）
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
            return new UploadResult(publicUrl, storageKey, mime, bytes.length);
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

    /** 上传结果（对齐 tos-media-extract.ts:86-91 返回形状）。 */
    public record UploadResult(String url, String storageKey, String mime, long size) {}

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
