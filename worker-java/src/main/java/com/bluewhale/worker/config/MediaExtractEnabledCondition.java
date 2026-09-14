package com.bluewhale.worker.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * 条件：WORKER_ENABLED_TAGS 包含 "media_extract"。
 * <p>
 * 控制 media_extract 相关 bean 的创建（MQ consumer + processor + TOS + ffmpeg）。
 * 未启用时不创建这些 bean，DataSource 也不需要（应用可安全拉起 /ready）。
 */
public class MediaExtractEnabledCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String tags = context.getEnvironment().getProperty("worker.enabled-tags", "");
        if (tags == null || tags.isBlank()) return false;
        for (String tag : tags.split(",")) {
            if ("media_extract".equals(tag.trim())) return true;
        }
        return false;
    }
}
