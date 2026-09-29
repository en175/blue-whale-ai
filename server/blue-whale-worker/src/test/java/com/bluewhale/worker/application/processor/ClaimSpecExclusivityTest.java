package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.audio.NewApiAudioClient;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
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
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationModelCapabilityMapper;
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

/**
 * 「一个处理器 ↔ 一份领取规格」的两道钉桩（IKIWP8 / ADR-0119）：
 *
 * <ol>
 *   <li><b>一致性</b>：恰好 15 个处理器声明 {@link ClaimSpec}，且每份 spec 的
 *       {@code type()} 等于它自己的 {@code tag()}。规格是数据，复制了别的家族的 spec
 *       却忘了改 type / 候选查询时类型系统不报错，这条断言是成本最低的第一道防线。</li>
 *   <li><b>排他</b>：一条 {@code type=X} 的 job 喂给全部 15 份 spec，只有 type 对得上的
 *       那一份能领到（套 source 白名单的族还要 source 也命中）。</li>
 * </ol>
 *
 * <p>为什么用 {@link ApplicationContextRunner} 扫包（照抄 {@code NewApiUpstreamWiringTest}
 * 的先例）：规格由各处理器**自己构造并持有**，`claimSpec()` 是 default 方法，唯一能拿到全部
 * 15 份真实规格的方式就是把处理器装配起来。扫包会连带第 1 类三个生成族一起实例化，故依赖
 * 一律以 mock 形式备齐。
 *
 * <p>为什么不连真库：候选查询与 CAS 的 SQL 由 {@code GenerationJobMySqlIntegrationTest} 那类
 * 集成测试覆盖；本测试钉的是**规格数据的分派**——用假 mapper 复刻真 SQL 的过滤语义
 * （type 命中 + source 命中），不起连接池、不写库。CAS 一律返回 1（候选命中的那条领得成功），
 * mapper 无状态，同一条 job 可以被 15 份 spec 反复试领。
 */
class ClaimSpecExclusivityTest {

    /** 声明 claimSpec 的工具族数量（第 1 类三个生成族不覆盖，返回 Optional.empty）。 */
    private static final int TOOL_FAMILY_COUNT = 15;

    /**
     * 只扫处理器包（该包里带 @Component 的类 = 18 个 JobProcessor，全部是顶层类）。
     * <p>
     * <b>排除嵌套类</b>：扫包的 classpath 含 test-classes，同包几个集成测试把 {@code @Configuration}
     * 写成了嵌套类（{@code PromptPlanVideoIntegrationTest$Database}、
     * {@code AudioVideoMuxCancelQueryErrorMySqlIntegrationTest$TestConfig}），扫进来会因两者都
     * 定义 {@code dataSource} 而 {@code BeanDefinitionOverrideException}。处理器无一嵌套类，
     * 故按「类名含 {@code $}」整类排除，不逐个点名测试类（点名会让新测试夹具再次炸这里）。
     */
    @Configuration
    @ComponentScan(basePackages = "com.bluewhale.worker.application.processor",
            excludeFilters = @ComponentScan.Filter(
                    type = FilterType.REGEX, pattern = ".*\\$.*"))
    static class ProcessorScanFixture {}

    // ========== 断言 1：一致性 ==========

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

            // 第 1 类三个生成族仍走 JobClaimService 的具名方法，不构造 spec
            assertThat(notDeclaring)
                    .as("未声明 claimSpec 的处理器（只应是第 1 类三个生成族）")
                    .containsExactlyInAnyOrder(
                            AudioJobProcessor.class.getName(),
                            ImageJobProcessor.class.getName(),
                            VideoJobProcessor.class.getName());
        });
    }

    // ========== 断言 2：排他 ==========

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

    // ========== 夹具 ==========

    /**
     * 对全部 15 份真实规格依次试领同一个 jobId，返回 {@code tag → 是否领到}。
     * <p>
     * mapper 是假的、CAS 不落库，同一 job 可被反复试领，无需在两次试领之间重建数据。
     */
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

    /**
     * 复刻真 SQL 过滤语义的假 mapper（Mockito 默认答案形式，一个 bean 够用）：
     * <ul>
     *   <li>候选查询——jobId 与 type 都命中（{@code findCandidateByTypeAndSources} 还要求
     *       {@code sources.contains(job.source)}）才返回候选行，否则 null；</li>
     *   <li>{@code *Cas}——一律返回 1（候选命中的那条领得成功）；</li>
     *   <li>其余方法——按返回类型给默认值。</li>
     * </ul>
     */
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

    /** 候选行命中：jobId 与 type 都要对上（job 为 null 时恒不命中）。 */
    private static boolean matches(GenerationJobEntity job, Long jobId, String type) {
        return job != null && job.getId().equals(jobId) && job.getType().equals(type);
    }

    /** 非候选 / 非 CAS 方法按返回类型给默认值（原语不能返回 null）。 */
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

    // ========== 装配：扫包会把第 1 类生成族一起实例化，全部依赖以 mock 备齐 ==========

    private static ApplicationContextRunner runnerWith(GenerationJobMapper jobMapper) {
        return new ApplicationContextRunner()
                .withUserConfiguration(ProcessorScanFixture.class)
                // 通用依赖
                .withBean(JobStateMachineService.class, () -> mock(JobStateMachineService.class))
                .withBean(JobClaimService.class, () -> new JobClaimService(jobMapper))
                .withBean(JobFinalizer.class, () -> mock(JobFinalizer.class))
                .withBean(GenerationJobMapper.class, () -> jobMapper)
                .withBean(AssetSourceService.class, () -> mock(AssetSourceService.class))
                .withBean(GenerationCredentialService.class,
                        () -> mock(GenerationCredentialService.class))
                .withBean(TosMediaStorage.class, () -> mock(TosMediaStorage.class))
                .withBean(TosAudioMediaRelay.class, () -> mock(TosAudioMediaRelay.class))
                .withBean(TosVideoMediaRelay.class, () -> mock(TosVideoMediaRelay.class))
                // 第 1 类生成族（image / audio / video by-id）客户端
                .withBean(NewApiImageClient.class, () -> mock(NewApiImageClient.class))
                .withBean(NewApiAudioClient.class, () -> mock(NewApiAudioClient.class))
                .withBean(NewApiVideoClient.class, () -> mock(NewApiVideoClient.class))
                .withBean(GenerationModelCapabilityMapper.class,
                        () -> mock(GenerationModelCapabilityMapper.class))
                // 15 个工具族客户端
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
                // 生产者：注入点带 @Qualifier，必须按名字注册（只给一个无名 bean 不够）
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
