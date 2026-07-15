package com.blue.whale.agent.support;

import com.blue.whale.agent.service.generation.GenerationStorage;
import com.blue.whale.agent.service.generation.GenerationObjectReader;
import com.blue.whale.agent.service.generation.GenerationObjectSigner;
import com.blue.whale.agent.service.generation.GenerationObjectDeletionStorage;
import com.blue.whale.agent.service.generation.PreparedGenerationObject;
import com.blue.whale.agent.service.generation.PreparedVideoGenerationObject;
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
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class FakeGenerationStorage implements
        GenerationStorage, VideoGenerationStorage, GenerationObjectReader, GenerationObjectSigner,
        GenerationObjectDeletionStorage {

    private final Map<String, byte[]> objects = new ConcurrentHashMap<>();

    @Override
    public PreparedGenerationObject prepare(byte[] content, String mimeType) {
        String digest = sha256(content);
        String storageKey = "fake/sha256/" + digest;
        return new PreparedGenerationObject(storageKey, digest, mimeType, content.length);
    }

    @Override
    public StoredGenerationObject store(PreparedGenerationObject prepared, byte[] content) {
        objects.putIfAbsent(prepared.storageKey(), Arrays.copyOf(content, content.length));
        return new StoredGenerationObject(prepared.storageKey(), prepared.contentSha256(),
                prepared.mimeType(), prepared.sizeBytes());
    }

    @Override
    public PreparedVideoGenerationObject prepareVideo(
            Long jobId,
            int slotIndex,
            long contentLength,
            String mimeType) {
        return new PreparedVideoGenerationObject(
                "fake/video/jobs/" + jobId + "/slot-" + slotIndex + "/"
                        + UUID.randomUUID() + ".mp4",
                mimeType, contentLength);
    }

    @Override
    public StoredGenerationObject storeVideo(
            PreparedVideoGenerationObject prepared,
            InputStream content) {
        try {
            byte[] bytes = content.readAllBytes();
            if (bytes.length != prepared.sizeBytes()) {
                throw new IllegalArgumentException("Fake 视频长度不一致");
            }
            String digest = sha256(bytes);
            objects.putIfAbsent(prepared.storageKey(), Arrays.copyOf(bytes, bytes.length));
            return new StoredGenerationObject(
                    prepared.storageKey(), digest, prepared.mimeType(), bytes.length);
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

    @Override
    public void delete(String storageKey) {
        objects.remove(storageKey);
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
