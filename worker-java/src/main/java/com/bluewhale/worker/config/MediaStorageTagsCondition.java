package com.bluewhale.worker.config;

import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.type.AnnotatedTypeMetadata;

/**
 * 条件：WORKER_ENABLED_TAGS 含 audio / image / media_extract 任一——即需要直传 TOS
 * 结果媒体的刀（TosMediaStorage 的注入方：三个对应 Processor）。
 * <p>
 * 与 {@link GenerationTagsCondition} 集合不同：step（video）不在此列——
 * video 走 TosVideoMediaRelay（已按 VideoEnabledCondition 门控且缺 TOS 返回 null 宽容降级）；
 * media_extract 不在生成刀集合但强依赖 TOS（契约 §8 硬失败）。
 * <p>
 * 背景：TosMediaStorage 曾是无条件 @Component，空 tag 安全拉起（README 承诺）被其
 * 构造器「TOS configuration required」打崩——多阶段 docker build 首验时暴露
 * （此前本地裸跑 shell 里恰好 export 了 VOLC_*，掩盖了装配缺口）。
 */
public class MediaStorageTagsCondition implements Condition {

    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String tags = context.getEnvironment().getProperty("worker.enabled-tags", "");
        if (tags == null || tags.isBlank()) return false;
        for (String tag : tags.split(",")) {
            String t = tag.trim();
            if (t.equals("audio") || t.equals("image") || t.equals("media_extract")) return true;
        }
        return false;
    }
}
