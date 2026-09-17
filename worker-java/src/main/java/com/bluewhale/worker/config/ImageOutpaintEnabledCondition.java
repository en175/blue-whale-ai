package com.bluewhale.worker.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * 条件：WORKER_ENABLED_TAGS 包含 "image_outpaint"（IKGOQW，附录 C 触点②）。
 * <p>
 * 控制 image_outpaint 相关 bean 的创建（MQ consumer + processor + MediaKit 客户端）。
 * 未启用时不创建这些 bean（安全拉起 /ready 语义不变）。
 */
public class ImageOutpaintEnabledCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String tags = context.getEnvironment().getProperty("worker.enabled-tags", "");
        if (tags == null || tags.isBlank()) return false;
        for (String tag : tags.split(",")) {
            if (com.bluewhale.worker.domain.entity.ImageOutpaintContract.TAG.equals(tag.trim())) return true;
        }
        return false;
    }
}
