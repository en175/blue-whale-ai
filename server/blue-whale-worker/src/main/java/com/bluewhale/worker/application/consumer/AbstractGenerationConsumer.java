package com.bluewhale.worker.application.consumer;

import com.bluewhale.common.mq.MqEnvSuffix;
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
        this.consumerGroup = MqEnvSuffix.apply(consumerGroup);
    }

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

    private void receiveLoop() {
        while (running) {
            try {
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

    String topic() {
        return topic;
    }

    String tag() {
        return consumerTag;
    }

    boolean processBody(byte[] body) {
        GenerationMessage parsed = GenerationMessage.parse(body, digitGuard);

        if (parsed == null) {
            String rawPreview = body != null && body.length > 0
                    ? new String(body, 0, Math.min(body.length, 120), java.nio.charset.StandardCharsets.UTF_8)
                    : "<empty>";
            log.warn("[{}] 毒丸丢弃(不可解析) bodyPreview={}", consumerTag, rawPreview);
            return true;
        }

        try {
            processor.handle(parsed.jobId());
            return true;
        } catch (Exception e) {
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
