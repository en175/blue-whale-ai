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

public class TosAudioMediaRelay {

    private static final Logger log = LoggerFactory.getLogger(TosAudioMediaRelay.class);

    private static final ScheduledExecutorService DOWNLOAD_WATCHDOG = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "audio-relay-watchdog");
        thread.setDaemon(true);
        return thread;
    });

    static final String KEY_TYPE_SEGMENT = "audio";

    static final long MAX_RELAY_BYTES = 10L << 30;

    private final TOSV2 client;
    private final String bucket;
    private final String endpoint;
    private final HttpClient httpClient;
    private final long maxRelayBytes;

    public TosAudioMediaRelay(TOSV2 client, String bucket, String endpoint) {
        this(client, bucket, endpoint, MAX_RELAY_BYTES);
    }

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

    public static TosAudioMediaRelay fromEnv() {
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
        return new TosAudioMediaRelay(client, bucketEnv, normalizedEndpoint);
    }

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

    public record StoredAudio(String url, String storageKey, String mime, Long size, String md5) {}

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
