package com.blue.whale.agent.support;

import com.blue.whale.agent.service.generation.GenerationStorage;
import com.blue.whale.agent.service.generation.GenerationObjectReader;
import com.blue.whale.agent.service.generation.GenerationObjectSigner;
import com.blue.whale.agent.service.generation.SignedGenerationObject;
import com.blue.whale.agent.service.generation.StoredGenerationObject;
import com.blue.whale.agent.service.generation.VideoGenerationStorage;

import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class FakeGenerationStorage implements
        GenerationStorage, VideoGenerationStorage, GenerationObjectReader, GenerationObjectSigner {

    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    @Override
    public StoredGenerationObject store(byte[] content, String mimeType) {
        String digest = sha256(content);
        String storageKey = "fake/sha256/" + digest;
        objects.putIfAbsent(storageKey, Arrays.copyOf(content, content.length));
        return new StoredGenerationObject(storageKey, digest, mimeType, content.length);
    }

    @Override
    public StoredGenerationObject storeVideo(
            Long jobId,
            int slotIndex,
            InputStream content,
            long contentLength,
            String mimeType) {
        try {
            byte[] bytes = content.readAllBytes();
            if (bytes.length != contentLength) {
                throw new IllegalArgumentException("Fake 视频长度不一致");
            }
            String digest = sha256(bytes);
            String storageKey = "fake/video/jobs/" + jobId + "/slot-" + slotIndex + ".mp4";
            objects.put(storageKey, Arrays.copyOf(bytes, bytes.length));
            return new StoredGenerationObject(storageKey, digest, mimeType, bytes.length);
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }

    @Override
    public byte[] read(String storageKey) {
        byte[] content = objects.get(storageKey);
        return content == null ? null : Arrays.copyOf(content, content.length);
    }

    @Override
    public SignedGenerationObject sign(String storageKey) {
        return new SignedGenerationObject(
                "https://fake-storage.invalid/" + storageKey + "?signature=test-only",
                Instant.now().plusSeconds(300));
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
