package com.bluewhale.worker.infrastructure.credential;

import org.springframework.stereotype.Component;

/**
 * 生成凭证读取（修正四：凭证去密）。
 * <p>
 * 2026-09-12 用户拍板：Redis 会话 sealedSk 与 job.input.provider_credential 均改明文，
 * AES-256-GCM 密封/解封链路与 {@code GENERATION_CREDENTIAL_SECRET} 依赖整体删除。
 * 本类保留为调用方统一入口（processor 仍经 open() 取 token），实现退化为明文直通。
 * <p>
 * 契约：docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md §5 修正四。
 */
@Component
@org.springframework.context.annotation.Conditional(com.bluewhale.worker.config.GenerationTagsCondition.class)
public class GenerationCredentialService {

    /**
     * 取明文 sk token（原 openGenerationCredential 的去密版）。
     *
     * @param credential job.input.provider_credential 的明文值
     * @return 同一明文 token（不再解密）
     */
    public String open(String credential) {
        if (credential == null || credential.isEmpty()) {
            throw new IllegalArgumentException("生成凭证为空");
        }
        return credential;
    }
}
