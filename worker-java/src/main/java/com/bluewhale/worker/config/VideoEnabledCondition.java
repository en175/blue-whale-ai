package com.bluewhale.worker.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * 条件：WORKER_ENABLED_TAGS 包含 "step"（视频 tag）。
 * <p>
 * 控制视频相关 bean 的创建（MQ consumer + processor + producer + relay）。
 * 未启用时不创建这些 bean（应用可安全拉起 /ready）。
 * <p>
 * 视频 tag = "step"（queue.constants.ts:11 VIDEO_TAG），与消费者 tag 一致。
 */
public class VideoEnabledCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String tags = context.getEnvironment().getProperty("worker.enabled-tags", "");
        if (tags == null || tags.isBlank()) return false;
        for (String tag : tags.split(",")) {
            if ("step".equals(tag.trim())) return true;
        }
        return false;
    }
}
