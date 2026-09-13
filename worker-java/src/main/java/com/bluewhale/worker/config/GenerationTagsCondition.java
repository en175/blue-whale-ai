package com.bluewhale.worker.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * 条件：WORKER_ENABLED_TAGS 含 audio / image / step 任一——即需要调上游模型
 * （new-api）与取用 per-job 明文凭证的刀（修正五：凭证去密，不再解封）。纯 media_extract 部署不实例化
 * NewApiImageClient / NewApiAudioClient / GenerationCredentialService，
 * 避免 extract-only 环境因未注入 NEW_API_BASE_URL 而拒绝启动（修正四：GENERATION_CREDENTIAL_SECRET 已废弃）
 * （二轮评审 Important×3；README 承诺与实现对齐）。
 */
public class GenerationTagsCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String tags = context.getEnvironment().getProperty("worker.enabled-tags", "");
        if (tags == null || tags.isBlank()) return false;
        for (String tag : tags.split(",")) {
            String t = tag.trim();
            if (t.equals("audio") || t.equals("image") || t.equals("step")) return true;
        }
        return false;
    }
}
