package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitAdjustAudioSpeedClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitCutoutClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEnhanceVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEraseClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitExtractAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitInterpolateVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMatteVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMixAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitOutpaintClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSegmentScenesClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSeparateVoiceClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitSubtitleEraseClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitTrimAudioClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosAudioMediaRelay;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.FilterType;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class ClaimSpecExclusivityTest {

    private static final int TOOL_FAMILY_COUNT = 15;

    @Configuration
    @ComponentScan(basePackages = "com.bluewhale.worker.application.processor",
            excludeFilters = @ComponentScan.Filter(
                    type = FilterType.REGEX, pattern = ".*\\$.*"))
    static class ProcessorScanFixture {}


    @Test
    @DisplayName("一致性：恰好 15 个处理器声明 claimSpec，且每份 type() 等于自己的 tag()")
    void fifteenProcessorsDeclareMatchingClaimSpec() {
        runnerWith(mock(GenerationJobMapper.class)).run(ctx -> {
            assertThat(ctx.getStartupFailure()).isNull();

            Map<String, JobProcessor> processors = ctx.getBeansOfType(JobProcessor.class);

            List<String> declaring = new ArrayList<>();
            List<String> notDeclaring = new ArrayList<>();
            for (JobProcessor processor : processors.values()) {
                Optional<ClaimSpec> spec = processor.claimSpec();
                if (spec.isEmpty()) {
                    notDeclaring.add(processor.getClass().getName());
                    continue;
                }
                declaring.add(processor.getClass().getName());

                assertThat(spec.get().type())
                        .as("处理器 %s 的 claimSpec().type() 必须等于它自己的 tag()",
                                processor.getClass().getName())
                        .isEqualTo(processor.tag());
            }

            assertThat(declaring)
                    .as("声明了 claimSpec 的处理器（每个带类名便于定位）")
                    .hasSize(TOOL_FAMILY_COUNT);

            assertThat(notDeclaring)
                    .as("未声明 claimSpec 的处理器（只应是第 1 类三个生成族）")
                    .containsExactlyInAnyOrder(
                            AudioJobProcessor.class.getName(),
                            ImageJobProcessor.class.getName(),
                            VideoJobProcessor.class.getName());
        });
    }


    @Test
    @DisplayName("排他：type=media_extract 的 job（不套白名单族）只有 media_extract 领得到")
    void typeOnlySpecIsExclusive() {
        GenerationJobEntity job = job(MediaExtractContract.TAG, MediaExtractContract.SOURCE);

        assertThat(claimOutcomes(job))
                .as("type=%s 的 job 喂给全部 15 份 spec 后的领取结果", job.getType())
                .hasSize(TOOL_FAMILY_COUNT);

        assertThat(winners(claimOutcomes(job)))
                .as("能领到 type=%s 的家族（应当是唯一一个）", job.getType())
                .containsExactly(MediaExtractContract.TAG);
    }

    @Test
    @DisplayName("排他：type=video_matting 的 job（套白名单族）只有 video_matting 领得到")
    void bySourcesSpecIsExclusive() {
        GenerationJobEntity job = job(VideoMattingContract.TAG, VideoMattingContract.SOURCE);

        assertThat(winners(claimOutcomes(job)))
                .as("能领到 type=%s + source=%s 的家族（应当是唯一一个）",
                        job.getType(), job.getSource())
                .containsExactly(VideoMattingContract.TAG);
    }

    @Test
    @DisplayName("白名单生效：type 对但 source 不在白名单内的 job，一个家族也领不到")
    void bySourcesSpecRejectsForeignSource() {
        GenerationJobEntity job = job(VideoMattingContract.TAG, "some_other_canvas_entry");

        assertThat(winners(claimOutcomes(job)))
                .as("source 不在白名单内时不应有家族能领到 type=%s", job.getType())
                .isEmpty();
    }


    private Map<String, Boolean> claimOutcomes(GenerationJobEntity job) {
        Map<String, Boolean> outcomes = new LinkedHashMap<>();
        runnerWith(fakeMapper(job)).run(ctx -> {
            assertThat(ctx.getStartupFailure()).isNull();
            JobClaimService claimService = ctx.getBean(JobClaimService.class);

            for (JobProcessor processor : ctx.getBeansOfType(JobProcessor.class).values()) {
                Optional<ClaimSpec> spec = processor.claimSpec();
                if (spec.isEmpty()) {
                    continue;
                }
                Optional<ClaimedJob> claimed = claimService.claim(
                        spec.get(), job.getId().toString(), "worker-1");
                outcomes.put(processor.tag(), claimed.isPresent());
            }
        });
        return outcomes;
    }

    private static List<String> winners(Map<String, Boolean> outcomes) {
        return outcomes.entrySet().stream()
                .filter(Map.Entry::getValue)
                .map(Map.Entry::getKey)
                .toList();
    }

    private static GenerationJobEntity job(String type, String source) {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(100L);
        job.setProjectId(42L);
        job.setUserId(9L);
        job.setType(type);
        job.setSource(source);
        job.setStatus("queued");
        job.setFencingToken(5L);
        job.setInput("{}");
        return job;
    }

    private static GenerationJobMapper fakeMapper(GenerationJobEntity job) {
        return mock(GenerationJobMapper.class, invocation -> {
            String method = invocation.getMethod().getName();
            Object[] args = invocation.getArguments();

            switch (method) {
                case "findCandidateByTypeOnly":
                    return matches(job, (Long) args[0], (String) args[1]) ? job : null;
                case "findCandidateByTypeAndSources":
                    @SuppressWarnings("unchecked")
                    List<String> sources = (List<String>) args[2];
                    return matches(job, (Long) args[0], (String) args[1])
                            && sources.contains(job.getSource()) ? job : null;
                case "toString":
                    return "fakeGenerationJobMapper";
                case "hashCode":
                    return System.identityHashCode(invocation.getMock());
                case "equals":
                    return invocation.getArgument(0) == invocation.getMock();
                default:
                    break;
            }

            if (method.endsWith("Cas")) {
                return 1;
            }
            return defaultValue(invocation);
        });
    }

    private static boolean matches(GenerationJobEntity job, Long jobId, String type) {
        return job != null && job.getId().equals(jobId) && job.getType().equals(type);
    }

    private static Object defaultValue(InvocationOnMock invocation) {
        Class<?> returnType = invocation.getMethod().getReturnType();
        if (!returnType.isPrimitive()) {
            return null;
        }
        if (returnType == boolean.class) {
            return false;
        }
        if (returnType == int.class) {
            return 0;
        }
        if (returnType == long.class) {
            return 0L;
        }
        if (returnType == double.class) {
            return 0d;
        }
        if (returnType == float.class) {
            return 0f;
        }
        if (returnType == short.class) {
            return (short) 0;
        }
        if (returnType == byte.class) {
            return (byte) 0;
        }
        if (returnType == char.class) {
            return (char) 0;
        }
        return null;
    }


    private static ApplicationContextRunner runnerWith(GenerationJobMapper jobMapper) {
        return new ApplicationContextRunner()
                .withUserConfiguration(ProcessorScanFixture.class)
                .withBean(JobStateMachineService.class, () -> mock(JobStateMachineService.class))
                .withBean(JobClaimService.class, () -> new JobClaimService(jobMapper, mock(GenerationJobExtraMapper.class)))
                .withBean(JobFinalizer.class, () -> mock(JobFinalizer.class))
                .withBean(GenerationJobMapper.class, () -> jobMapper)
                .withBean(AssetSourceService.class, () -> mock(AssetSourceService.class))
                .withBean(UpstreamCredential.class,
                        () -> mock(UpstreamCredential.class))
                .withBean(TosMediaStorage.class, () -> mock(TosMediaStorage.class))
                .withBean(TosAudioMediaRelay.class, () -> mock(TosAudioMediaRelay.class))
                .withBean(TosVideoMediaRelay.class, () -> mock(TosVideoMediaRelay.class))
                .withBean(NewApiImageClient.class, () -> mock(NewApiImageClient.class))
                .withBean(NewApiAudioClient.class, () -> mock(NewApiAudioClient.class))
                .withBean(NewApiVideoClient.class, () -> mock(NewApiVideoClient.class))
                .withBean(GenerationModelCapabilityMapper.class,
                        () -> mock(GenerationModelCapabilityMapper.class))
                .withBean(NewApiMediaKitClient.class, () -> mock(NewApiMediaKitClient.class))
                .withBean(NewApiMediaKitEraseClient.class, () -> mock(NewApiMediaKitEraseClient.class))
                .withBean(NewApiMediaKitCutoutClient.class, () -> mock(NewApiMediaKitCutoutClient.class))
                .withBean(NewApiMediaKitOutpaintClient.class,
                        () -> mock(NewApiMediaKitOutpaintClient.class))
                .withBean(NewApiMediaKitExtractAudioClient.class,
                        () -> mock(NewApiMediaKitExtractAudioClient.class))
                .withBean(NewApiMediaKitMixAudioClient.class,
                        () -> mock(NewApiMediaKitMixAudioClient.class))
                .withBean(NewApiMediaKitMuxAudioVideoClient.class,
                        () -> mock(NewApiMediaKitMuxAudioVideoClient.class))
                .withBean(NewApiMediaKitTrimAudioClient.class,
                        () -> mock(NewApiMediaKitTrimAudioClient.class))
                .withBean(NewApiMediaKitAdjustAudioSpeedClient.class,
                        () -> mock(NewApiMediaKitAdjustAudioSpeedClient.class))
                .withBean(NewApiMediaKitSubtitleEraseClient.class,
                        () -> mock(NewApiMediaKitSubtitleEraseClient.class))
                .withBean(NewApiMediaKitEnhanceVideoClient.class,
                        () -> mock(NewApiMediaKitEnhanceVideoClient.class))
                .withBean(NewApiMediaKitSeparateVoiceClient.class,
                        () -> mock(NewApiMediaKitSeparateVoiceClient.class))
                .withBean(NewApiMediaKitSegmentScenesClient.class,
                        () -> mock(NewApiMediaKitSegmentScenesClient.class))
                .withBean(NewApiMediaKitMatteVideoClient.class,
                        () -> mock(NewApiMediaKitMatteVideoClient.class))
                .withBean(NewApiMediaKitInterpolateVideoClient.class,
                        () -> mock(NewApiMediaKitInterpolateVideoClient.class))
                .withBean("audioMixMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("audioSpeedMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("audioTrimMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("audioVideoMuxMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("mediaExtractMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("videoEnhanceMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("videoFrameInterpolationMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("videoMattingMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("videoSceneSplitMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("videoSubtitleEraseMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("vocalSplitMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class))
                .withBean("generationMessageProducer", GenerationMessageProducer.class,
                        () -> mock(GenerationMessageProducer.class));
    }
}
