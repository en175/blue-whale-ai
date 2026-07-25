package com.blue.whale.agent.service.generation;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Agent Plan 模式（IK21O4）本地磁盘生成存储：内容寻址（{@code local/sha256/{digest}}），
 * 对象落 {@code agent-plan.storage-root} 指向的目录（Docker 卷挂载，重启不丢）。
 * 不签发任何公开或长期 URL，媒体内容只经 Project 边界校验后的受控端点读出。
 * 仅供 {@code blue-whale.generation.mode=agent-plan} 装配；切到 TOS 等对象存储由
 * 后续工单负责（{@link GenerationStorage} 接口抽象现成）。
 */
public class LocalDiskGenerationStorage implements
        GenerationStorage, GenerationObjectReader, GenerationObjectDeletionStorage {

    private static final String STORAGE_KEY_PREFIX = "local/sha256/";

    private final Path storageRoot;

    public LocalDiskGenerationStorage(GenerationAdapterProperties properties) {
        this.storageRoot = Path.of(properties.getAgentPlan().getStorageRoot())
                .toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.storageRoot);
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "本地磁盘生成存储根目录不可用: " + this.storageRoot, exception);
        }
    }

    @Override
    public PreparedGenerationObject prepare(byte[] content, String mimeType) {
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("只允许存储非空内容");
        }
        String digest = sha256(content);
        return new PreparedGenerationObject(
                STORAGE_KEY_PREFIX + digest, digest, mimeType, content.length);
    }

    @Override
    public StoredGenerationObject store(PreparedGenerationObject prepared, byte[] content) {
        if (prepared == null || content == null || content.length != prepared.sizeBytes()
                || !sha256(content).equals(prepared.contentSha256())) {
            throw new IllegalArgumentException("内容与预备对象不一致");
        }
        Path target = resolve(prepared.storageKey());
        if (!Files.exists(target)) {
            writeAtomic(target, content);
        }
        return new StoredGenerationObject(prepared.storageKey(), prepared.contentSha256(),
                prepared.mimeType(), prepared.sizeBytes());
    }

    @Override
    public byte[] read(String storageKey) {
        Path target = resolve(storageKey);
        if (!Files.exists(target)) {
            return null;
        }
        try {
            return Files.readAllBytes(target);
        } catch (IOException exception) {
            throw new IllegalStateException("读取本地磁盘生成对象失败: " + target, exception);
        }
    }

    @Override
    public void delete(String storageKey) {
        Path target = resolve(storageKey);
        try {
            Files.deleteIfExists(target);
        } catch (IOException exception) {
            throw new IllegalStateException("删除本地磁盘生成对象失败: " + target, exception);
        }
    }

    private void writeAtomic(Path target, byte[] content) {
        Path parent = target.getParent();
        try {
            Files.createDirectories(parent);
        } catch (IOException exception) {
            throw new IllegalStateException("创建存储目录失败: " + parent, exception);
        }
        Path tmp = null;
        try {
            tmp = Files.createTempFile(parent, ".upload-", ".tmp");
            Files.write(tmp, content);
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException exception) {
            throw new IllegalStateException("写入本地磁盘生成对象失败: " + target, exception);
        } finally {
            if (tmp != null) {
                try {
                    Files.deleteIfExists(tmp);
                } catch (IOException ignored) {
                    // 成功 move 后 tmp 已不存在；失败时清理残留临时文件
                }
            }
        }
    }

    private Path resolve(String storageKey) {
        if (storageKey == null || !storageKey.startsWith(STORAGE_KEY_PREFIX)) {
            throw new IllegalArgumentException("非法 storageKey 前缀: " + storageKey);
        }
        String tail = storageKey.substring(STORAGE_KEY_PREFIX.length());
        // digest 为 64 位十六进制，不含路径分隔符或点段，杜绝路径穿越
        if (!tail.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("非法 storageKey 摘要: " + storageKey);
        }
        Path resolved = storageRoot.resolve(storageKey).normalize();
        if (!resolved.startsWith(storageRoot)) {
            throw new IllegalArgumentException("storageKey 逃逸存储根目录: " + storageKey);
        }
        return resolved;
    }

    private String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("JDK 不支持 SHA-256", exception);
        }
    }
}
