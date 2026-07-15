package com.blue.whale.agent.service.generation;

import com.volcengine.tos.TOSV2;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.GetObjectV2Input;
import com.volcengine.tos.model.object.GetObjectV2Output;
import com.volcengine.tos.model.object.DeleteObjectInput;
import com.volcengine.tos.model.object.ObjectMetaRequestOptions;
import com.volcengine.tos.model.object.PreSignedURLInput;
import com.volcengine.tos.model.object.PreSignedURLOutput;
import com.volcengine.tos.model.object.PutObjectInput;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import java.util.UUID;

public class TosGenerationStorage implements
        GenerationStorage, VideoGenerationStorage, GenerationObjectReader, GenerationObjectSigner,
        GenerationObjectDeletionStorage {

    private final TOSV2 tosClient;
    private final GenerationAdapterProperties properties;
    private final Clock clock;

    public TosGenerationStorage(
            TOSV2 tosClient,
            GenerationAdapterProperties properties,
            Clock clock) {
        this.tosClient = tosClient;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public PreparedGenerationObject prepare(byte[] content, String mimeType) {
        if (content == null || content.length == 0 || !"image/png".equals(mimeType)) {
            throw new IllegalArgumentException("只允许存储非空 PNG 图片");
        }
        String digest = sha256(content);
        String storageKey = normalizedPrefix() + "/sha256/" + digest + ".png";
        return new PreparedGenerationObject(storageKey, digest, mimeType, content.length);
    }

    @Override
    public StoredGenerationObject store(PreparedGenerationObject prepared, byte[] content) {
        if (prepared == null || content == null || content.length != prepared.sizeBytes()
                || !sha256(content).equals(prepared.contentSha256())) {
            throw new IllegalArgumentException("图片内容与预备对象不一致");
        }
        ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                .setContentType(prepared.mimeType())
                .setAclType(ACLType.ACL_PRIVATE);
        PutObjectInput input = new PutObjectInput()
                .setBucket(properties.getTos().getBucket())
                .setKey(prepared.storageKey())
                .setContent(new ByteArrayInputStream(content))
                .setContentLength(content.length)
                .setOptions(options);
        tosClient.putObject(input);
        return new StoredGenerationObject(prepared.storageKey(), prepared.contentSha256(),
                prepared.mimeType(), prepared.sizeBytes());
    }

    @Override
    public PreparedVideoGenerationObject prepareVideo(
            Long jobId,
            int slotIndex,
            long contentLength,
            String mimeType) {
        long maxBytes = properties.getTos().getMaxVideoBytes();
        if (jobId == null || slotIndex < 0
                || contentLength <= 0 || contentLength > maxBytes
                || !"video/mp4".equals(mimeType)) {
            throw new IllegalArgumentException("只允许在大小上限内存储非空 MP4 视频");
        }
        String storageKey = normalizedPrefix() + "/video/jobs/" + jobId
                + "/slot-" + slotIndex + "/" + UUID.randomUUID() + ".mp4";
        return new PreparedVideoGenerationObject(storageKey, mimeType, contentLength);
    }

    @Override
    public StoredGenerationObject storeVideo(
            PreparedVideoGenerationObject prepared,
            InputStream content) {
        if (prepared == null || content == null) {
            throw new IllegalArgumentException("视频内容与预备对象不一致");
        }
        long maxBytes = properties.getTos().getMaxVideoBytes();
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            DigestInputStream digestStream = new DigestInputStream(
                    new BoundedInputStream(content, maxBytes), digest);
            ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                    .setContentType(prepared.mimeType())
                    .setAclType(ACLType.ACL_PRIVATE);
            PutObjectInput input = new PutObjectInput()
                    .setBucket(properties.getTos().getBucket())
                    .setKey(prepared.storageKey())
                    .setContent(digestStream)
                    .setContentLength(prepared.sizeBytes())
                    .setOptions(options);
            tosClient.putObject(input);
            return new StoredGenerationObject(
                    prepared.storageKey(), HexFormat.of().formatHex(digest.digest()),
                    prepared.mimeType(), prepared.sizeBytes());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("JDK 不支持 SHA-256", exception);
        }
    }

    @Override
    public byte[] read(String storageKey) {
        GetObjectV2Input input = new GetObjectV2Input()
                .setBucket(properties.getTos().getBucket())
                .setKey(storageKey);
        int maxBytes = properties.getTos().getMaxReadBytes();
        try (GetObjectV2Output output = tosClient.getObject(input)) {
            if (output.getContentLength() > maxBytes) {
                throw new IllegalStateException("TOS 对象超过读取上限");
            }
            byte[] content = output.getContent().readNBytes(maxBytes + 1);
            if (content.length > maxBytes) {
                throw new IllegalStateException("TOS 对象超过读取上限");
            }
            return content;
        } catch (IOException exception) {
            throw new IllegalStateException("读取 TOS 对象失败", exception);
        }
    }

    @Override
    public SignedGenerationObject sign(String storageKey) {
        long ttlSeconds = properties.getTos().getSignedUrlTtlSeconds();
        PreSignedURLInput input = new PreSignedURLInput()
                .setHttpMethod("GET")
                .setBucket(properties.getTos().getBucket())
                .setKey(storageKey)
                .setExpires(ttlSeconds);
        PreSignedURLOutput output = tosClient.preSignedURL(input);
        return new SignedGenerationObject(output.getSignedUrl(), clock.instant().plusSeconds(ttlSeconds));
    }

    @Override
    public void delete(String storageKey) {
        tosClient.deleteObject(new DeleteObjectInput()
                .setBucket(properties.getTos().getBucket())
                .setKey(storageKey));
    }

    private String normalizedPrefix() {
        String prefix = properties.getTos().getPrefix();
        while (prefix.startsWith("/")) {
            prefix = prefix.substring(1);
        }
        while (prefix.endsWith("/")) {
            prefix = prefix.substring(0, prefix.length() - 1);
        }
        return prefix;
    }

    private String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("JDK 不支持 SHA-256", exception);
        }
    }

    private static final class BoundedInputStream extends FilterInputStream {

        private final long maxBytes;
        private long count;

        private BoundedInputStream(InputStream input, long maxBytes) {
            super(input);
            this.maxBytes = maxBytes;
        }

        @Override
        public int read() throws IOException {
            int value = super.read();
            if (value >= 0) {
                record(1);
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int read = super.read(buffer, offset, length);
            if (read > 0) {
                record(read);
            }
            return read;
        }

        private void record(int read) throws IOException {
            count += read;
            if (count > maxBytes) {
                throw new IOException("视频对象超过存储上限");
            }
        }
    }
}
