package com.blue.whale.agent.service.generation;

import com.volcengine.tos.TOSV2;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.GetObjectV2Input;
import com.volcengine.tos.model.object.GetObjectV2Output;
import com.volcengine.tos.model.object.ObjectMetaRequestOptions;
import com.volcengine.tos.model.object.PreSignedURLInput;
import com.volcengine.tos.model.object.PreSignedURLOutput;
import com.volcengine.tos.model.object.PutObjectInput;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;

public class TosGenerationStorage implements GenerationStorage, GenerationObjectReader, GenerationObjectSigner {

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
    public StoredGenerationObject store(byte[] content, String mimeType) {
        if (content == null || content.length == 0 || !"image/png".equals(mimeType)) {
            throw new IllegalArgumentException("只允许存储非空 PNG 图片");
        }
        String digest = sha256(content);
        String storageKey = normalizedPrefix() + "/sha256/" + digest + ".png";
        ObjectMetaRequestOptions options = new ObjectMetaRequestOptions()
                .setContentType(mimeType)
                .setAclType(ACLType.ACL_PRIVATE);
        PutObjectInput input = new PutObjectInput()
                .setBucket(properties.getTos().getBucket())
                .setKey(storageKey)
                .setContent(new ByteArrayInputStream(content))
                .setContentLength(content.length)
                .setOptions(options);
        tosClient.putObject(input);
        return new StoredGenerationObject(storageKey, digest, mimeType, content.length);
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
}
