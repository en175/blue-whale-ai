package com.bluewhale.worker.config;

import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * worker 运行配置。环境变量名与 TS 版逐一对齐（契约 §5），
 * 灰度期一套部署 env 同时喂两个栈。
 *
 * @param enabledTags  本实例接管消费的 tag 列表；为空 = 什么都不消费
 *                     （安全拉起默认值；按 tag 灰度开关，见契约 §1）
 * @param groupSuffix  consumer group 后缀（如 "-java"）；同一 tag 同一时刻
 *                     只允许一侧在消费（停一开一 = 灰度/回滚开关）
 */
@ConfigurationProperties(prefix = "worker")
public record WorkerProperties(
        Set<String> enabledTags,
        String groupSuffix,
        Concurrency concurrency) {

    public WorkerProperties {
        enabledTags = enabledTags == null ? Set.of() : enabledTags;
        groupSuffix = groupSuffix == null ? "-java" : groupSuffix;
        concurrency = concurrency == null ? new Concurrency(20, 5, 2, 5) : concurrency;
    }

    /** 各消费者的在制品上限，等价 TS 侧 Semaphore；取值范围与 TS 校验一致。 */
    public record Concurrency(int image, int audio, int mediaExtract, int imageEnhance) {
        public Concurrency {
            if (image < 1 || image > 64) {
                throw new IllegalArgumentException("IMAGE_CONCURRENCY 超出 1-64 范围: " + image);
            }
            if (audio < 1 || audio > 64) {
                throw new IllegalArgumentException("AUDIO_CONCURRENCY 超出 1-64 范围: " + audio);
            }
            if (mediaExtract < 1 || mediaExtract > 16) {
                throw new IllegalArgumentException("MEDIA_EXTRACT_CONCURRENCY 超出 1-16 范围: " + mediaExtract);
            }
            if (imageEnhance < 1 || imageEnhance > 64) {
                throw new IllegalArgumentException("IMAGE_ENHANCE_CONCURRENCY 超出 1-64 范围: " + imageEnhance);
            }
        }
    }

    /**
     * 视频无并发度配置（顺序消费，无 Semaphore）——
     * TS rocketmq-video.consumer.ts:60-74 for-await each，Java 侧同构。
     * 保留方法以兼容配置结构扩展。
     */
    public int videoConcurrency() {
        return 1; // 视频恒为顺序消费
    }
}
