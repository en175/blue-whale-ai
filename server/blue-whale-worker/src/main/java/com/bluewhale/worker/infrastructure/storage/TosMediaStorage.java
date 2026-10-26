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

@Component
public class TosMediaStorage {

    private static final Logger log = LoggerFactory.getLogger(TosMediaStorage.class);

    static final long HEARTBEAT_INTERVAL_MS = 30_000;

    private static final int DOWNLOAD_BUFFER_BYTES = 64 * 1024;

    private final TOSV2 client;
    private final String bucket;
    private final String endpoint;

    public TosMediaStorage() {
        String accessKeyId = System.getenv("VOLC_ACCESS_KEY_ID");
        String secretAccessKey = System.getenv("VOLC_SECRET_ACCESS_KEY");
        String endpointEnv = System.getenv("VOLC_TOS_ENDPOINT");
        String bucketEnv = System.getenv("VOLC_TOS_BUCKET");
        String region = System.getenv("VOLC_TOS_REGION");

        if (isBlank(accessKeyId) || isBlank(secretAccessKey)
                || isBlank(endpointEnv) || isBlank(bucketEnv) || isBlank(region)) {
            throw new IllegalStateException("TOS configuration required (VOLC_*)");
        }

        this.endpoint = endpointEnv.replaceFirst("^https?://", "").replaceFirst("/$", "");
        this.bucket = bucketEnv;

        this.client = new TOSV2ClientBuilder().build(
                region, this.endpoint, accessKeyId, secretAccessKey, TosTransportConfig.fromEnv());
    }

    TosMediaStorage(TOSV2 client, String bucket, String endpoint) {
        this.client = client;
        this.bucket = bucket;
        this.endpoint = endpoint;
    }

    public void download(String url, String storageKey, Path outputPath, long maxBytes) {
        download(url, storageKey, outputPath, maxBytes, null);
    }

    public void download(String url, String storageKey, Path outputPath, long maxBytes, Runnable onHeartbeat) {
        download(url, storageKey, outputPath, maxBytes, onHeartbeat, HEARTBEAT_INTERVAL_MS);
    }

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

    public UploadResult upload(Path filePath, String mime) {
        try {
            byte[] bytes = Files.readAllBytes(filePath);

            String uuid = UUID.randomUUID().toString().replace("-", "");
            String storageKey = "media-extract/audio/" + uuid + ".mp3";

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

    public UploadResult uploadImageBytes(byte[] data, String mime) {
        return uploadImageBytes(data, mime, "0");
    }

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

    public record UploadResult(String url, String storageKey, String mime, long size, String md5) {}

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
