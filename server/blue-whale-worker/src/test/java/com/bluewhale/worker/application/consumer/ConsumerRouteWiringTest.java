package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.AudioSpeedJobProcessor;
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

class ConsumerRouteWiringTest {

    private static final List<GenerationMqRouteEnum> ROUTES = List.of(
            GenerationMqRouteEnum.MEDIA_EXTRACT,
            GenerationMqRouteEnum.AUDIO_TRIM,
            GenerationMqRouteEnum.AUDIO_SPEED,
            GenerationMqRouteEnum.AUDIO,
            GenerationMqRouteEnum.IMAGE,
            GenerationMqRouteEnum.IMAGE_ENHANCE,
            GenerationMqRouteEnum.IMAGE_ERASE,
            GenerationMqRouteEnum.IMAGE_CUTOUT,
            GenerationMqRouteEnum.VIDEO,
            GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE,
            GenerationMqRouteEnum.VIDEO_ENHANCE,
            GenerationMqRouteEnum.VOCAL_SPLIT,
            GenerationMqRouteEnum.VIDEO_SCENE_SPLIT,
            GenerationMqRouteEnum.VIDEO_MATTING,
            GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION,
            GenerationMqRouteEnum.AUDIO_VIDEO_MUX);

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
        ClientConfiguration clientConfig = config.rocketMqClientConfiguration(env);

        List<AbstractGenerationConsumer> consumers = List.of(
                config.mediaExtractConsumer(
                        mock(MediaExtractJobProcessor.class), workerProps, clientConfig),
                config.audioTrimConsumer(
                        mock(AudioTrimJobProcessor.class), workerProps, clientConfig),
                config.audioSpeedConsumer(
                        mock(AudioSpeedJobProcessor.class), workerProps, clientConfig),
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
                        workerProps, clientConfig),
                config.videoMattingConsumer(
                        mock(com.bluewhale.worker.application.processor.VideoMattingJobProcessor.class),
                        workerProps, clientConfig),
                config.videoFrameInterpolationConsumer(
                        mock(com.bluewhale.worker.application.processor.VideoFrameInterpolationJobProcessor.class),
                        workerProps, clientConfig),
                config.audioVideoMuxConsumer(
                        mock(com.bluewhale.worker.application.processor.AudioVideoMuxJobProcessor.class),
                        workerProps, clientConfig));

        assertThat(consumers).hasSize(ROUTES.size());

        for (int i = 0; i < ROUTES.size(); i++) {
            GenerationMqRouteEnum route = ROUTES.get(i);
            AbstractGenerationConsumer consumer = consumers.get(i);

            assertThat(consumer.topic()).as("%s 订阅的 topic", route).isEqualTo(route.topic());
            assertThat(consumer.tag()).as("%s 订阅的 tag", route).isEqualTo(route.tag());
        }

        assertThat(consumers).extracting(AbstractGenerationConsumer::topic)
                .doesNotContain("generation-video");
        assertThat(consumers).extracting(AbstractGenerationConsumer::tag)
                .doesNotContain("step");
    }
}
