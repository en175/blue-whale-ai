package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.infrastructure.mq.GenerationMessage;

import com.bluewhale.worker.application.processor.JobProcessor;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
import org.apache.rocketmq.client.apis.SessionCredentialsProvider;
import org.apache.rocketmq.client.apis.StaticSessionCredentialsProvider;
import org.apache.rocketmq.client.apis.consumer.FilterExpression;
import org.apache.rocketmq.client.apis.consumer.FilterExpressionType;
import org.apache.rocketmq.client.apis.consumer.SimpleConsumer;
import org.apache.rocketmq.client.apis.message.MessageView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

/**
 * MQ 消费者 TEMPLATE METHOD（IKENSZ pattern spec：start/stop lifecycle, receive loop, poison ack）。
 * <p>
 * 逐字移植自 TS 消费者模板（rocketmq-extract.consumer.ts / rocketmq-audio.consumer.ts）：
 * <ul>
 *   <li>receive(10, 30_000)：batch=10，不可见期 30s（契约 §1）</li>
 *   <li>消息解析：GenerationMessage.parse(body, digitGuard)</li>
 *   <li>毒丸：parse 返回 null → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 后重投）—— 全仓无显式 nack（契约 §1）</li>
 *   <li>Semaphore 并发控制（与 TS Semaphore 类一致）</li>
 * </ul>
 * <p>
 * 子类只须指定 tag / digitGuard / processor / concurrency。
 */
public abstract class AbstractGenerationConsumer implements Closeable {

    private static final Logger log = LoggerFactory.getLogger(AbstractGenerationConsumer.class);

    private final String consumerTag;
    private final boolean digitGuard;
    private final JobProcessor processor;
    private final Semaphore semaphore;
    private final String topic;
    private final ClientConfiguration clientConfig;
    private final String consumerGroup;

    private volatile boolean running;
    private SimpleConsumer consumer;
    private Thread receiveThread;
    private ExecutorService dispatchExecutor;

    protected AbstractGenerationConsumer(
            String consumerTag,
            boolean digitGuard,
            JobProcessor processor,
            int concurrency,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup
    ) {
        this.consumerTag = consumerTag;
        this.digitGuard = digitGuard;
        this.processor = processor;
        this.semaphore = new Semaphore(concurrency);
        this.topic = topic;
        this.clientConfig = clientConfig;
        this.consumerGroup = consumerGroup;
    }

    /** 启动消费者（创建 SimpleConsumer + 启 receive 循环线程）。 */
    public void start() {
        ClientServiceProvider provider = ClientServiceProvider.loadService();

        try {
            consumer = provider.newSimpleConsumerBuilder()
                    .setClientConfiguration(clientConfig)
                    .setConsumerGroup(consumerGroup)
                    .setAwaitDuration(Duration.ofSeconds(30))
                    .setSubscriptionExpressions(Collections.singletonMap(
                            topic, new FilterExpression(consumerTag, FilterExpressionType.TAG)))
                    .build();
        } catch (Exception e) {
            throw new IllegalStateException("SimpleConsumer 创建失败: " + e.getMessage(), e);
        }

        // RocketMQ 5.x SimpleConsumer 无显式 start()——构造即可用
        running = true;
        dispatchExecutor = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "mq-dispatch-" + consumerTag);
            t.setDaemon(true);
            return t;
        });
        receiveThread = new Thread(this::receiveLoop, "mq-receive-" + consumerTag);
        receiveThread.setDaemon(true);
        receiveThread.start();

        log.info("MQ 消费者已启动: topic={} tag={} group={} concurrency={}",
                topic, consumerTag, consumerGroup, semaphore.availablePermits());
    }

    /** 停止消费者（关闭 receive 循环 + SimpleConsumer）。 */
    public void stop() {
        running = false;
        if (receiveThread != null) {
            receiveThread.interrupt();
        }
        if (dispatchExecutor != null) {
            dispatchExecutor.shutdownNow();
        }
        if (consumer != null) {
            try {
                consumer.close();
            } catch (Exception e) {
                log.warn("关闭 SimpleConsumer 异常: {}", e.getMessage(), e);
            }
        }
        log.info("MQ 消费者已停止: tag={}", consumerTag);
    }

    @Override
    public void close() {
        stop();
    }

    /**
     * Receive 循环（rocketmq-extract.consumer.ts:75-92 loop()）。
     * <p>
     * receive(10, 30s) → 逐条 acquire semaphore → fire-and-forget dispatch。
     * receive 失败 → 1s 后重试（与 TS 一致）。
     */
    private void receiveLoop() {
        while (running) {
            try {
                // 契约 §1：receive(10, 30_000)
                List<MessageView> messages = consumer.receive(10, Duration.ofSeconds(30));
                for (MessageView message : messages) {
                    if (!running) return;
                    try {
                        semaphore.acquire();
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                    if (!running) {
                        semaphore.release();
                        return;
                    }
                    // 并发派发（与 TS void this.dispatch(message) fire-and-forget 一致）
                    CompletableFuture.runAsync(
                            () -> dispatch(message), dispatchExecutor
                    );
                }
            } catch (Exception e) {
                if (!running) return;
                log.error("[{}] receive 失败，1s 后重试: {}", consumerTag, e.getMessage(), e);
                try {
                    Thread.sleep(1_000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    /**
     * 单消息派发（rocketmq-extract.consumer.ts:94-107 dispatch + processMessage）。
     * <p>
     * 解析 → 毒丸 ack → handler → 成功 ack。
     * handler 抛错 → 不 ack 不 nack（契约 §1：broker 30s 重投）。
     */
    private void dispatch(MessageView message) {
        try {
            processMessage(message);
        } catch (Exception e) {
            log.error("[{}] 消息处理异常 messageId={}: {}", consumerTag, message.getMessageId(), e.getMessage(), e);
        } finally {
            semaphore.release();
        }
    }

    private void processMessage(MessageView message) {
        byte[] body = readBody(message);
        boolean shouldAck = processBody(body);

        if (shouldAck) {
            try {
                consumer.ack(message);
            } catch (Exception e) {
                log.warn("[{}] ack 失败 messageId={}: {}", consumerTag, message.getMessageId(), e.getMessage(), e);
            }
        }
    }

    /** 订阅的 topic（package-private：供同包测试断言订阅值，其余用途请勿扩用）。 */
    String topic() {
        return topic;
    }

    /** 订阅的 tag（即 {@code start()} 里 FilterExpression 用的那个；package-private，同上）。 */
    String tag() {
        return consumerTag;
    }

    /**
     * 处理消息体，返回是否应 ack（package-private：供测试使用）。
     * <p>
     * true = ack（毒丸或 handler 成功）；false = 不 ack（handler 抛错 → broker 重投）。
     * 与 TS processMessage 逻辑完全一致（rocketmq-extract.consumer.ts:111-156）。
     */
    boolean processBody(byte[] body) {
        GenerationMessage parsed = GenerationMessage.parse(body, digitGuard);

        // 毒丸：parse 返回 null → ack 丢弃（契约 §1）
        if (parsed == null) {
            String rawPreview = body != null && body.length > 0
                    ? new String(body, 0, Math.min(body.length, 120), java.nio.charset.StandardCharsets.UTF_8)
                    : "<empty>";
            log.warn("[{}] 毒丸丢弃(不可解析) bodyPreview={}", consumerTag, rawPreview);
            return true;
        }

        // handler（契约 §1：成功才 ack；handler 抛错 → 不 ack 不 nack）
        try {
            processor.handle(parsed.jobId());
            return true;
        } catch (Exception e) {
            // 瞬时失败：不 ack → 不可见期后重投（与 TS 逐字一致）
            log.warn("[{}] handle 失败，等待重投 jobId={}: {}",
                    consumerTag, parsed.jobId(), e.getMessage(), e);
            return false;
        }
    }

    private byte[] readBody(MessageView message) {
        ByteBuffer buffer = message.getBody();
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);
        return bytes;
    }
}
