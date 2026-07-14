package com.blue.whale.agent.support;

import com.blue.whale.agent.service.generation.GenerationStorage;
import com.blue.whale.agent.service.generation.GenerationObjectReader;
import com.blue.whale.agent.service.generation.StoredGenerationObject;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class FakeGenerationStorage implements GenerationStorage, GenerationObjectReader {

    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    @Override
    public StoredGenerationObject store(byte[] content, String mimeType) {
        String digest = sha256(content);
        String storageKey = "fake/sha256/" + digest;
        objects.putIfAbsent(storageKey, Arrays.copyOf(content, content.length));
        return new StoredGenerationObject(storageKey, digest, mimeType, content.length);
    }

    @Override
    public byte[] read(String storageKey) {
        byte[] content = objects.get(storageKey);
        return content == null ? null : Arrays.copyOf(content, content.length);
    }

    public void clear() {
        objects.clear();
    }

    private String sha256(byte[] content) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }
}
