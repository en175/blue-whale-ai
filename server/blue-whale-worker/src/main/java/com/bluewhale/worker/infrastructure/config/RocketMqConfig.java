package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.worker.application.consumer.AudioConsumer;
import com.bluewhale.worker.application.consumer.AudioSpeedConsumer;
import com.bluewhale.worker.application.consumer.AudioTrimConsumer;
import com.bluewhale.worker.application.consumer.ImageConsumer;
import com.bluewhale.worker.application.consumer.ImageEnhanceConsumer;
import com.bluewhale.worker.application.consumer.ImageCutoutConsumer;
import com.bluewhale.worker.application.consumer.ImageEraseConsumer;
import com.bluewhale.worker.application.consumer.MediaExtractConsumer;
import com.bluewhale.worker.application.consumer.VideoConsumer;
import com.bluewhale.worker.application.processor.AudioJobProcessor;
import com.bluewhale.worker.application.processor.AudioSpeedJobProcessor;
import com.bluewhale.worker.application.processor.AudioTrimJobProcessor;
import com.bluewhale.worker.application.processor.ImageEnhanceJobProcessor;
import com.bluewhale.worker.application.processor.ImageCutoutJobProcessor;
import com.bluewhale.worker.application.processor.ImageEraseJobProcessor;
import com.bluewhale.worker.application.processor.ImageJobProcessor;
import com.bluewhale.worker.application.processor.MediaExtractJobProcessor;
import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.mq.RocketMqBillingEventPublisher;
import com.bluewhale.worker.infrastructure.mq.RocketMqGenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import org.apache.rocketmq.client.apis.ClientConfiguration;
import org.apache.rocketmq.client.apis.ClientConfigurationBuilder;
import org.apache.rocketmq.client.apis.StaticSessionCredentialsProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration
public class RocketMqConfig {

    private static final Logger log = LoggerFactory.getLogger(RocketMqConfig.class);

    private static final RocketMqProperties DEFAULT_MQ_PROPS =
            new RocketMqProperties("", "", "", false);

    public record RocketMqProperties(
            String endpoints,
            String accessKey,
            String secretKey,
            boolean sslEnabled
    ) {
        public RocketMqProperties {
            endpoints = endpoints == null ? "" : endpoints;
            accessKey = accessKey == null ? "" : accessKey;
            secretKey = secretKey == null ? "" : secretKey;
        }
    }

    @Bean
    public ClientConfiguration rocketMqClientConfiguration(Environment env) {
        RocketMqProperties mqProps = Binder.get(env)
                .bind("rocketmq", RocketMqProperties.class)
                .orElse(DEFAULT_MQ_PROPS);

        if (mqProps.endpoints().isBlank()) {
            throw new IllegalStateException(
                    "ROCKETMQ_ENDPOINTS 未配置：RocketMQ 客户端无法启动");
        }

        ClientConfigurationBuilder configBuilder = ClientConfiguration.newBuilder()
                .setEndpoints(mqProps.endpoints())
                .enableSsl(mqProps.sslEnabled());

        if (!mqProps.accessKey().isBlank() && !mqProps.secretKey().isBlank()) {
            configBuilder.setCredentialProvider(
                    new StaticSessionCredentialsProvider(mqProps.accessKey(), mqProps.secretKey()));
        }

        return configBuilder.build();
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public MediaExtractConsumer mediaExtractConsumer(
            MediaExtractJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-extract-worker";
        int concurrency = workerProps.concurrency().mediaExtract();

        return new MediaExtractConsumer(
                processor,
                GenerationMqRouteEnum.MEDIA_EXTRACT.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.AudioMixConsumer audioMixConsumer(
            com.bluewhale.worker.application.processor.AudioMixJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig) {
        return new com.bluewhale.worker.application.consumer.AudioMixConsumer(
                processor, GenerationMqRouteEnum.AUDIO_MIX.topic(), clientConfig,
                "generation-audio-mix-worker", workerProps.concurrency().mediaExtract());
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.AudioVideoMuxConsumer audioVideoMuxConsumer(
            com.bluewhale.worker.application.processor.AudioVideoMuxJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig) {
        return new com.bluewhale.worker.application.consumer.AudioVideoMuxConsumer(
                processor, GenerationMqRouteEnum.AUDIO_VIDEO_MUX.topic(), clientConfig,
                "generation-audio-video-mux-worker", workerProps.concurrency().mediaExtract());
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public AudioTrimConsumer audioTrimConsumer(
            AudioTrimJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-audio-trim-worker";
        int concurrency = workerProps.concurrency().audioTrim();

        return new AudioTrimConsumer(
                processor,
                GenerationMqRouteEnum.AUDIO_TRIM.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public AudioSpeedConsumer audioSpeedConsumer(
            AudioSpeedJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-audio-speed-worker";
        int concurrency = workerProps.concurrency().audioSpeed();

        return new AudioSpeedConsumer(
                processor,
                GenerationMqRouteEnum.AUDIO_SPEED.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public AudioConsumer audioConsumer(
            AudioJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-audio-worker";
        int concurrency = workerProps.concurrency().audio();

        return new AudioConsumer(
                processor,
                GenerationMqRouteEnum.AUDIO.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public ImageConsumer imageConsumer(
            ImageJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-image-worker";
        int concurrency = workerProps.concurrency().image();

        return new ImageConsumer(
                processor,
                GenerationMqRouteEnum.IMAGE.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public ImageEnhanceConsumer imageEnhanceConsumer(
            ImageEnhanceJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-image-enhance-worker";
        int concurrency = workerProps.concurrency().imageEnhance();

        return new ImageEnhanceConsumer(
                processor,
                GenerationMqRouteEnum.IMAGE_ENHANCE.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public ImageEraseConsumer imageEraseConsumer(
            ImageEraseJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-image-erase-worker";
        int concurrency = workerProps.concurrency().imageErase();

        return new ImageEraseConsumer(
                processor,
                GenerationMqRouteEnum.IMAGE_ERASE.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public ImageCutoutConsumer imageCutoutConsumer(
            ImageCutoutJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-image-cutout-worker";
        int concurrency = workerProps.concurrency().imageCutout();

        return new ImageCutoutConsumer(
                processor,
                GenerationMqRouteEnum.IMAGE_CUTOUT.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.ImageOutpaintConsumer imageOutpaintConsumer(
            com.bluewhale.worker.application.processor.ImageOutpaintJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-image-outpaint-worker";
        int concurrency = workerProps.concurrency().imageOutpaint();

        return new com.bluewhale.worker.application.consumer.ImageOutpaintConsumer(
                processor,
                GenerationMqRouteEnum.IMAGE_OUTPAINT.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.VideoSubtitleEraseConsumer videoSubtitleEraseConsumer(
            com.bluewhale.worker.application.processor.VideoSubtitleEraseJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-video-subtitle-erase-worker";
        int concurrency = workerProps.concurrency().videoSubtitleErase();

        return new com.bluewhale.worker.application.consumer.VideoSubtitleEraseConsumer(
                processor,
                GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.VideoEnhanceConsumer videoEnhanceConsumer(
            com.bluewhale.worker.application.processor.VideoEnhanceJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-video-enhance-worker";
        int concurrency = workerProps.concurrency().videoEnhance();

        return new com.bluewhale.worker.application.consumer.VideoEnhanceConsumer(
                processor,
                GenerationMqRouteEnum.VIDEO_ENHANCE.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.VocalSplitConsumer vocalSplitConsumer(
            com.bluewhale.worker.application.processor.VocalSplitJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-vocal-split-worker";
        int concurrency = workerProps.concurrency().vocalSplit();

        return new com.bluewhale.worker.application.consumer.VocalSplitConsumer(
                processor,
                GenerationMqRouteEnum.VOCAL_SPLIT.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.VideoSceneSplitConsumer videoSceneSplitConsumer(
            com.bluewhale.worker.application.processor.VideoSceneSplitJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-video-scene-split-worker";
        int concurrency = workerProps.concurrency().videoSceneSplit();

        return new com.bluewhale.worker.application.consumer.VideoSceneSplitConsumer(
                processor,
                GenerationMqRouteEnum.VIDEO_SCENE_SPLIT.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.VideoMattingConsumer videoMattingConsumer(
            com.bluewhale.worker.application.processor.VideoMattingJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-video-matting-worker";
        int concurrency = workerProps.concurrency().videoMatting();

        return new com.bluewhale.worker.application.consumer.VideoMattingConsumer(
                processor,
                GenerationMqRouteEnum.VIDEO_MATTING.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public com.bluewhale.worker.application.consumer.VideoFrameInterpolationConsumer videoFrameInterpolationConsumer(
            com.bluewhale.worker.application.processor.VideoFrameInterpolationJobProcessor processor,
            WorkerProperties workerProps,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-video-frame-interpolation-worker";
        int concurrency = workerProps.concurrency().videoFrameInterpolation();

        return new com.bluewhale.worker.application.consumer.VideoFrameInterpolationConsumer(
                processor,
                GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION.topic(),
                clientConfig,
                consumerGroup,
                concurrency
        );
    }


    @Bean(destroyMethod = "close")
    public GenerationMessageProducer generationMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.VIDEO.topic(),
                GenerationMqRouteEnum.VIDEO.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoSubtitleEraseMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE.topic(),
                GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer mediaExtractMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.MEDIA_EXTRACT.topic(),
                GenerationMqRouteEnum.MEDIA_EXTRACT.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioTrimMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.AUDIO_TRIM.topic(),
                GenerationMqRouteEnum.AUDIO_TRIM.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioMixMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig, GenerationMqRouteEnum.AUDIO_MIX.topic(), GenerationMqRouteEnum.AUDIO_MIX.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioVideoMuxMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig, GenerationMqRouteEnum.AUDIO_VIDEO_MUX.topic(), GenerationMqRouteEnum.AUDIO_VIDEO_MUX.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioSpeedMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.AUDIO_SPEED.topic(),
                GenerationMqRouteEnum.AUDIO_SPEED.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoEnhanceMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.VIDEO_ENHANCE.topic(),
                GenerationMqRouteEnum.VIDEO_ENHANCE.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer vocalSplitMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.VOCAL_SPLIT.topic(),
                GenerationMqRouteEnum.VOCAL_SPLIT.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoSceneSplitMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.VIDEO_SCENE_SPLIT.topic(),
                GenerationMqRouteEnum.VIDEO_SCENE_SPLIT.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoMattingMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.VIDEO_MATTING.topic(),
                GenerationMqRouteEnum.VIDEO_MATTING.tag());
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoFrameInterpolationMessageProducer(ClientConfiguration clientConfig) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig,
                GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION.topic(),
                GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION.tag());
    }


    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.IMAGE);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.AUDIO);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer mediaExtractRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.MEDIA_EXTRACT);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioTrimRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.AUDIO_TRIM);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioMixRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.AUDIO_MIX);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioVideoMuxRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.AUDIO_VIDEO_MUX);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer audioSpeedRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.AUDIO_SPEED);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageEnhanceRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.IMAGE_ENHANCE);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageEraseRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.IMAGE_ERASE);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageCutoutRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.IMAGE_CUTOUT);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer imageOutpaintRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.IMAGE_OUTPAINT);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoSubtitleEraseRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoEnhanceRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.VIDEO_ENHANCE);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer vocalSplitRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.VOCAL_SPLIT);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoSceneSplitRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.VIDEO_SCENE_SPLIT);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoMattingRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.VIDEO_MATTING);
    }

    @Bean(destroyMethod = "close")
    public GenerationMessageProducer videoFrameInterpolationRecoveryProducer(ClientConfiguration clientConfig) {
        return createProducerForTag(clientConfig, GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION);
    }

    private GenerationMessageProducer createProducerForTag(
            ClientConfiguration clientConfig, GenerationMqRouteEnum route) {
        return RocketMqGenerationMessageProducer.create(
                clientConfig, route.topic(), route.tag());
    }

    @Bean(destroyMethod = "close")
    public BillingEventPublisher billingEventPublisher(ClientConfiguration clientConfig) {
        return RocketMqBillingEventPublisher.create(clientConfig);
    }

    @Bean
    public NewApiVideoClient newApiVideoClient(NewApiUpstreamConfig.UpstreamBaseUrl baseUrl) {
        return new NewApiVideoClient(baseUrl);
    }

    @Bean
    public TosVideoMediaRelay tosVideoMediaRelay() {
        return TosVideoMediaRelay.fromEnv();
    }

    @Bean
    public com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay tosAudioMediaRelay() {
        return com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay.fromEnv();
    }

    @Bean(initMethod = "start", destroyMethod = "stop")
    public VideoConsumer videoConsumer(
            VideoJobProcessor processor,
            ClientConfiguration clientConfig
    ) {
        String consumerGroup = "generation-video-worker";

        return new VideoConsumer(
                processor,
                GenerationMqRouteEnum.VIDEO.topic(),
                clientConfig,
                consumerGroup
        );
    }
}
