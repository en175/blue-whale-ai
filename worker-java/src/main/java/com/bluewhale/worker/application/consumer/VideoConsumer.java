package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.infrastructure.mq.GenerationMessage;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientServiceProvider;
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

/**
 * 视频消费者（rocketmq-video.consumer.ts 逐字移植）。
 * <p>
 * 与 image/audio/extract 不同：视频采用 <b>SEQUENTIAL</b> 派发（无 Semaphore），
 * 单条消息顺序处理（runStep 是短步骤：submit/poll + DB 写）。
 * <p>
 * TS 行为（rocketmq-video.consumer.ts:60-74 loop）：
 * <ul>
 *   <li>receive(10, 30s) → for-await processMessage</li>
 *   <li>毒丸：body.jobId 非字符串 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 * <p>
 * 不做 digitGuard（视频 TS :78-83 仅检查 typeof body.jobId === "string"）。
 * <p>
 * 每条 step 消息驱动一个 claim→submit/poll→scheduleNext 步骤；
 * 下一个 5s 延迟消息由 processor 自投到同一 topic/tag。
 */
public class VideoConsumer implements Closeable {

    private static final Logger log = LoggerFactory.getLogger(VideoConsumer.class);

    /** tag（queue.constants.ts:11 VIDEO_TAG = "step"）。 */
    public static final String TAG = "step";

    private final JobProcessor processor;
    private final String topic;
    private final ClientConfiguration clientConfig;
    private final String consumerGroup;

    private volatile boolean running;
    private SimpleConsumer consumer;
    private Thread receiveThread;

    public VideoConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup
    ) {
        this.processor = processor;
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
                            topic, new FilterExpression(TAG, FilterExpressionType.TAG)))
                    .build();
        } catch (Exception e) {
            throw new IllegalStateException("SimpleConsumer 创建失败: " + e.getMessage(), e);
        }

        running = true;
        receiveThread = new Thread(this::receiveLoop, "mq-receive-video");
        receiveThread.setDaemon(true);
        receiveThread.start();

        log.info("MQ 视频消费者已启动: topic={} tag={} group={}", topic, TAG, consumerGroup);
    }

    /** 停止消费者。 */
    public void stop() {
        running = false;
        if (receiveThread != null) {
            receiveThread.interrupt();
        }
        if (consumer != null) {
            try {
                consumer.close();
            } catch (Exception e) {
                log.warn("关闭 SimpleConsumer 异常: {}", e.getMessage());
            }
        }
        log.info("MQ 视频消费者已停止: tag={}", TAG);
    }

    @Override
    public void close() {
        stop();
    }

    /**
     * Receive 循环（rocketmq-video.consumer.ts:60-74 loop）。
     * <p>
     * receive(10, 30s) → 逐条顺序 processMessage。
     * receive 失败 → 1s 后重试（与 TS 一致）。
     */
    private void receiveLoop() {
        while (running) {
            try {
                List<MessageView> messages = consumer.receive(10, Duration.ofSeconds(30));
                for (MessageView message : messages) {
                    if (!running) return;
                    processMessage(message);
                }
            } catch (Exception e) {
                if (!running) return;
                log.error("receive 失败，1s 后重试: {}", e.getMessage());
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
     * 单消息处理（rocketmq-video.consumer.ts:76-101 processMessage）。
     * <p>
     * 解析 → 毒丸 ack → handler → 成功 ack。
     * handler 抛错 → 不 ack 不 nack（契约 §1：broker 30s 重投）。
     */
    private void processMessage(MessageView message) {
        boolean shouldAck = processBody(readBody(message));
        if (shouldAck) {
            try {
                consumer.ack(message);
            } catch (Exception e) {
                log.warn("ack 失败: {}", e.getMessage());
            }
        }
    }

    /**
     * 处理消息体（package-private：供测试使用）。
     * <p>
     * true = ack（毒丸或 handler 成功）；false = 不 ack（handler 抛错）。
     * 与 TS processMessage 逻辑完全一致（rocketmq-video.consumer.ts:76-101）。
     * <p>
     * 不做 digitGuard（视频 TS 仅检查 typeof jobId === "string"）。
     */
    boolean processBody(byte[] body) {
        GenerationMessage parsed = GenerationMessage.parse(body, false);

        // 毒丸：parse 返回 null → ack 丢弃
        if (parsed == null) {
            return true;
        }

        try {
            processor.handle(parsed.jobId());
            return true;
        } catch (Exception e) {
            log.warn("handle 失败，等待重投 jobId={}: {}", parsed.jobId(), e.getMessage());
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
