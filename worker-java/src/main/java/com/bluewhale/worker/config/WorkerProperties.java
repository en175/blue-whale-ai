package com.bluewhale.worker.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * worker 运行配置。环境变量名与 TS 版逐一对齐（契约 §5）。
 * <p>
 * 消费者与 processor 全部无条件装配（ADR-0084 修正六）：本类不再持有
 * tag 开关或 consumer group 后缀，只剩各消费者的并发度上限。
 *
 * @param concurrency 各消费者的在制品上限
 */
@ConfigurationProperties(prefix = "worker")
public record WorkerProperties(
        Concurrency concurrency) {

    public WorkerProperties {
        concurrency = concurrency == null ? new Concurrency(20, 5, 2, 5, 5) : concurrency;
    }

    /** 各消费者的在制品上限，等价 TS 侧 Semaphore；取值范围与 TS 校验一致。 */
    public record Concurrency(int image, int audio, int mediaExtract, int imageEnhance, int imageErase) {
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
            if (imageErase < 1 || imageErase > 64) {
                throw new IllegalArgumentException("IMAGE_ERASE_CONCURRENCY 超出 1-64 范围: " + imageErase);
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
