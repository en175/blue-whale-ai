package com.blue.whale.agent.service.generation;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 本地非生产 Fake 生成存储：进程内内存、内容寻址（{@code fake/sha256/{digest}}），
 * 不签发任何公开或长期 URL；媒体内容只经 Project 边界校验后的受控端点读出。
 * 仅供 {@code blue-whale.generation.mode=fake} 装配。
 */
public class LocalFakeGenerationStorage implements
        GenerationStorage, GenerationObjectReader, GenerationObjectDeletionStorage {

    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    @Override
    public PreparedGenerationObject prepare(byte[] content, String mimeType) {
        String digest = sha256(content);
        return new PreparedGenerationObject("fake/sha256/" + digest, digest, mimeType, content.length);
    }

    @Override
    public StoredGenerationObject store(PreparedGenerationObject prepared, byte[] content) {
        objects.putIfAbsent(prepared.storageKey(), Arrays.copyOf(content, content.length));
        return new StoredGenerationObject(prepared.storageKey(), prepared.contentSha256(),
                prepared.mimeType(), prepared.sizeBytes());
    }

    @Override
    public byte[] read(String storageKey) {
        byte[] content = objects.get(storageKey);
        return content == null ? null : Arrays.copyOf(content, content.length);
    }

    @Override
    public void delete(String storageKey) {
        objects.remove(storageKey);
    }

    /** 本地重置（init / 测试隔离用）；生产不存在本适配器。 */
    public void clear() {
        objects.clear();
    }

    private String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
