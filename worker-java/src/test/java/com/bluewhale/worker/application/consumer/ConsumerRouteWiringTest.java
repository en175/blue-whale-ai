package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.AudioTrimJobProcessor;
import com.bluewhale.worker.application.processor.ImageCutoutJobProcessor;
import com.bluewhale.worker.application.processor.ImageEnhanceJobProcessor;
import com.bluewhale.worker.application.processor.ImageEraseJobProcessor;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.application.processor.VideoSubtitleEraseJobProcessor;
import com.bluewhale.worker.config.RocketMqConfig;
import com.bluewhale.worker.config.WorkerProperties;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;

import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 七条消费路由的接线断言（ADR-0084 修正六）：
 * 部署环境里残留的 {@code ROCKETMQ_TOPIC=generation-video} / {@code ROCKETMQ_TAG=step}
 * **改不了任何消费者的订阅**——订阅的 topic / tag 只来自 {@link GenerationMqRouteEnum}。
 * <p>
 * 与 {@code com.bluewhale.worker.config.StartupContractTest#retiredTopicAndTagPropertiesAreIgnored}
 * 的分工：那边钉「属性层不报错、记录里没有 topic / tag 分量」，这边钉「不生效」。
 * 订阅值经 {@link AbstractGenerationConsumer#topic()} / {@link AbstractGenerationConsumer#tag()}
 * 读取——即 {@code start()} 里 {@code FilterExpression} 用的那两个字段，故本类必须与模板同包
 * （访问器是 package-private，不为此放宽到 public）。
 * <p>
 * 直接调 {@link RocketMqConfig} 的 bean 方法构造消费者、不走 Spring 生命周期，是刻意的：
 * 消费者 bean 是 {@code initMethod = "start"}，真起上下文就会建真实 SimpleConsumer 去连
 * {@code rocketmq.endpoints}，无 broker 的机器上必定失败（实测失败文案「SimpleConsumer 创建失败」）。
 * 本用例要验的是「喂进订阅表达式的值」，与能不能连上 broker 无关。
 * <p>
 * 连接配置经唯一的 {@code rocketMqClientConfiguration(env)} 构建（修正六之后全类仅此一处绑定），
 * 再把产物注入各 consumer bean 方法——即生产装配的同一条路径。
 */
class ConsumerRouteWiringTest {

    /** 各消费者按 {@link GenerationMqRouteEnum} 的顺序对位（前八个走 workerProps 并发度，video 顺序消费）。 */
    private static final List<GenerationMqRouteEnum> ROUTES = List.of(
            GenerationMqRouteEnum.MEDIA_EXTRACT,
            GenerationMqRouteEnum.AUDIO_TRIM,
            GenerationMqRouteEnum.AUDIO,
            GenerationMqRouteEnum.IMAGE,
            GenerationMqRouteEnum.IMAGE_ENHANCE,
            GenerationMqRouteEnum.IMAGE_ERASE,
            GenerationMqRouteEnum.IMAGE_CUTOUT,
            GenerationMqRouteEnum.VIDEO,
            GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE,
            GenerationMqRouteEnum.VIDEO_ENHANCE,
            GenerationMqRouteEnum.VOCAL_SPLIT,
            GenerationMqRouteEnum.VIDEO_SCENE_SPLIT);

    /** 残留旧名的部署环境（修正六之前的 topic / tag 取值）。 */
    private static StandardEnvironment residualOverrideEnvironment() {
        Map<String, Object> props = new HashMap<>();
        props.put("rocketmq.endpoints", "127.0.0.1:8081");
        props.put("rocketmq.topic", "generation-video");
        props.put("rocketmq.tag", "step");

        StandardEnvironment env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("residual-overrides", props));
        return env;
    }

    @Test
    @DisplayName("残留 rocketmq.topic / rocketmq.tag 下，各消费者仍订阅 GenerationMqRoute 的 topic / tag")
    void consumersSubscribeEnumRouteDespiteResidualOverrides() {
        RocketMqConfig config = new RocketMqConfig();
        WorkerProperties workerProps = new WorkerProperties(null);
        StandardEnvironment env = residualOverrideEnvironment();
        // 全类唯一的连接配置构建点：残留属性只喂到这里，且绑不到任何 topic / tag 分量。
        ClientConfiguration clientConfig = config.rocketMqClientConfiguration(env);

        // 顺序与 ROUTES 对位：前八个走 workerProps 并发度，video 顺序消费不带并发度。
        List<AbstractGenerationConsumer> consumers = List.of(
                config.mediaExtractConsumer(
                        mock(MediaExtractJobProcessor.class), workerProps, clientConfig),
                config.audioTrimConsumer(
                        mock(AudioTrimJobProcessor.class), workerProps, clientConfig),
                config.audioConsumer(mock(AudioJobProcessor.class), workerProps, clientConfig),
                config.imageConsumer(mock(ImageJobProcessor.class), workerProps, clientConfig),
                config.imageEnhanceConsumer(
                        mock(ImageEnhanceJobProcessor.class), workerProps, clientConfig),
                config.imageEraseConsumer(
                        mock(ImageEraseJobProcessor.class), workerProps, clientConfig),
                config.imageCutoutConsumer(
                        mock(ImageCutoutJobProcessor.class), workerProps, clientConfig),
                config.videoConsumer(mock(VideoJobProcessor.class), clientConfig),
                config.videoSubtitleEraseConsumer(
                        mock(VideoSubtitleEraseJobProcessor.class), workerProps, clientConfig),
                config.videoEnhanceConsumer(
                        mock(com.bluewhale.worker.application.processor.VideoEnhanceJobProcessor.class),
                        workerProps, clientConfig),
                config.vocalSplitConsumer(
                        mock(com.bluewhale.worker.application.processor.VocalSplitJobProcessor.class),
                        workerProps, clientConfig),
                config.videoSceneSplitConsumer(
                        mock(com.bluewhale.worker.application.processor.VideoSceneSplitJobProcessor.class),
                        workerProps, clientConfig));

        assertThat(consumers).hasSize(ROUTES.size());

        for (int i = 0; i < ROUTES.size(); i++) {
            GenerationMqRouteEnum route = ROUTES.get(i);
            AbstractGenerationConsumer consumer = consumers.get(i);

            assertThat(consumer.topic()).as("%s 订阅的 topic", route).isEqualTo(route.topic());
            assertThat(consumer.tag()).as("%s 订阅的 tag", route).isEqualTo(route.tag());
        }

        // 残留值一个也没漏进订阅（旧 topic / 旧 tag 都不在任何消费者的订阅里）。
        assertThat(consumers).extracting(AbstractGenerationConsumer::topic)
                .doesNotContain("generation-video");
        assertThat(consumers).extracting(AbstractGenerationConsumer::tag)
                .doesNotContain("step");
    }
}
