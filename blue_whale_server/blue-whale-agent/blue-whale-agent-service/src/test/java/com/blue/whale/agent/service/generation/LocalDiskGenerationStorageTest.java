package com.blue.whale.agent.service.generation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Agent Plan 模式本地磁盘生成存储（IK21O4）：内容寻址、读写往返、重启持久化、路径安全。
 */
class LocalDiskGenerationStorageTest {

    @TempDir
    Path tempDir;

    private GenerationAdapterProperties properties;
    private LocalDiskGenerationStorage storage;

    @BeforeEach
    void setUp() {
        properties = new GenerationAdapterProperties();
        properties.getAgentPlan().setStorageRoot(tempDir.toString());
        storage = new LocalDiskGenerationStorage(properties);
    }

    @Test
    void storesAndReadsContentAddressedObject() throws Exception {
        byte[] content = "agent-plan-png".getBytes(StandardCharsets.UTF_8);
        String digest = sha256(content);

        StoredGenerationObject stored = storage.store(content, "image/png");

        assertThat(stored.storageKey()).isEqualTo("local/sha256/" + digest);
        assertThat(stored.contentSha256()).isEqualTo(digest);
        assertThat(stored.mimeType()).isEqualTo("image/png");
        assertThat(stored.sizeBytes()).isEqualTo(content.length);
        assertThat(storage.read(stored.storageKey())).isEqualTo(content);
    }

    @Test
    void differentContentGetsDifferentKey() {
        byte[] a = "content-a".getBytes(StandardCharsets.UTF_8);
        byte[] b = "content-b".getBytes(StandardCharsets.UTF_8);

        StoredGenerationObject sa = storage.store(a, "image/png");
        StoredGenerationObject sb = storage.store(b, "image/png");

        assertThat(sa.storageKey()).isNotEqualTo(sb.storageKey());
        assertThat(storage.read(sa.storageKey())).isEqualTo(a);
        assertThat(storage.read(sb.storageKey())).isEqualTo(b);
    }

    @Test
    void storeIsIdempotentForSameContent() {
        byte[] content = "idempotent".getBytes(StandardCharsets.UTF_8);

        StoredGenerationObject first = storage.store(content, "image/jpeg");
        StoredGenerationObject second = storage.store(content, "image/jpeg");

        assertThat(second.storageKey()).isEqualTo(first.storageKey());
        assertThat(storage.read(first.storageKey())).isEqualTo(content);
    }

    @Test
    void deleteRemovesObject() {
        byte[] content = "to-delete".getBytes(StandardCharsets.UTF_8);
        StoredGenerationObject stored = storage.store(content, "image/png");

        storage.delete(stored.storageKey());

        assertThat(storage.read(stored.storageKey())).isNull();
    }

    @Test
    void persistedObjectSurvivesInstanceRestart() {
        byte[] content = "persisted-across-restart".getBytes(StandardCharsets.UTF_8);
        StoredGenerationObject stored = storage.store(content, "image/png");

        // 同 storageRoot 新实例，模拟容器重启后挂载同一 Docker 卷
        LocalDiskGenerationStorage restarted = new LocalDiskGenerationStorage(properties);

        assertThat(restarted.read(stored.storageKey())).isEqualTo(content);
    }

    @Test
    void rejectsPathTraversalStorageKey() {
        assertThatThrownBy(() -> storage.read("local/sha256/../../etc/passwd"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> storage.delete("local/sha256/not-hex"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> storage.read("evil/sha256/abc"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsEmptyContentInPrepare() {
        assertThatThrownBy(() -> storage.prepare(new byte[0], "image/png"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private String sha256(byte[] content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
    }
}
