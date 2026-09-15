package com.bluewhale.worker.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * 数据源装配总闸（刀①冒烟 + 刀③本地联调抓出的装配缺陷修复）：
 * 原实现把真 DataSource 的条件硬编码为 media_extract，导致只开 image/audio/video
 * 时进程连得上 MQ 却拿不到库（StubDataSource 兜底报错）。
 * 正确语义：WORKER_ENABLED_TAGS 非空即需要真库；为空（纯 /ready 探活）才允许 Stub。
 */
public final class TagsEnabledConditions {

    private TagsEnabledConditions() {
    }

    private static boolean anyTag(ConditionContext context) {
        String tags = context.getEnvironment().getProperty("worker.enabled-tags", "");
        if (tags == null || tags.isBlank()) {
            return false;
        }
        for (String tag : tags.split(",")) {
            if (!tag.isBlank()) {
                return true;
            }
        }
        return false;
    }

    /** 任一 tag 启用 → 装配真 DataSource。 */
    public static class AnyTagsEnabled implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return anyTag(context);
        }
    }

    /** 无任何 tag（安全拉起模式）→ 装配 Stub。 */
    public static class NoTagsEnabled implements Condition {
        @Override
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return !anyTag(context);
        }
    }
}
