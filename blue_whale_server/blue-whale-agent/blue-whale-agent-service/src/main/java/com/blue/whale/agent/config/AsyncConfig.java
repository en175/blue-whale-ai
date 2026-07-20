package com.blue.whale.agent.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.util.concurrent.Executor;

/**
 * 异步执行配置：{@code @EnableAsync} + {@code @EnableScheduling}（JobPoller 定时轮询）+ 生成任务专用线程池。
 *
 * <p>生成任务（调 Ark）走 {@link #GENERATION_EXECUTOR} 异步执行，不阻塞 Servlet 请求线程。
 * 视频生成耗时长（分钟级），线程池限流避免 Ark 限流 + 防止线程爆炸。
 */
@Configuration
@EnableAsync
@EnableScheduling
public class AsyncConfig {

    /** 生成任务线程池 bean 名，供 {@code @Async(GENERATION_EXECUTOR)} 引用。 */
    public static final String GENERATION_EXECUTOR = "generationExecutor";

    @Bean(name = GENERATION_EXECUTOR)
    public Executor generationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("gen-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    /**
     * SSE history TTL 清理专用调度器：单线程，与 {@link #GENERATION_EXECUTOR} 及 {@code @Scheduled}
     * 默认调度池隔离。供 {@code JobStreamBus#complete} 终态后挂一次性延迟任务清 history（§6.7），
     * 避免清理任务拖慢 {@code JobPoller} 的 5s 轮询节拍。
     */
    @Bean(name = "streamSweeperScheduler", destroyMethod = "shutdown")
    public ThreadPoolTaskScheduler streamSweeperScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("stream-sweeper-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(10);
        scheduler.initialize();
        return scheduler;
    }
}
