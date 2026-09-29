package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 出站协议 + 图生图别名分流测试（契约 §11 / ADR-0085 / IKF4LI）。
 * <p>
 * 规格：
 * <ul>
 *   <li>{@code image_protocol=inline-image}（含缺省）——行配了 {@code features.i2i_model_name}
 *       <strong>且</strong>本 job 带参考图时，出站 model 用别名（banana 现用）。</li>
 *   <li>{@code image_protocol=openai-images}——官方协议，模型名恒为 canonical，
 *       <strong>别名不生效</strong>（文生图/图生图同一档位，端点分流代替换名）。</li>
 * </ul>
 * canonical 不变量：只换出站请求字段，{@code job.input.model_id} 不动（计费/重试/恢复不受影响）。
 * <p>
 * 断言方式：generate stub 抛 provider_failed（retry_count=0 → requeue，不触发转存），
 * 用 ArgumentCaptor 钉住出站 protocol 与 model 实参。
 */
@ExtendWith(MockitoExtension.class)
class ImageJobProcessorI2iAliasTest {

    private static final String MODEL_ID = "nano-banana-2-t2i";
    private static final String ALIAS = "nano-banana-2-i2i";

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetSourceService assetSource;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiImageClient imageClient;
    @Mock private GenerationModelCapabilityMapper capabilityMapper;
    @Mock private TosMediaStorage tosService;

    private ImageJobProcessor processor;

    /** 出站实参快照（protocol + model）。 */
    private record Outbound(ImageProtocol protocol, String model) {}

    @BeforeEach
    void setUp() {
        processor = new ImageJobProcessor(
                stateMachine, finalizer, assetSource, credentialService,
                imageClient, capabilityMapper, tosService);
    }

    private Outbound captureOutbound(List<String> refs, String featuresJson) {
        return captureOutbound(refs, featuresJson, "seedream-image", "{}");
    }

    /** @param channel 能力行的 {@code channel} 列——出站协议与解析器都由它决定（不再读 features 键）。
     *  @param requestMapping gpt / banana 渠道必须给一张能解出尺寸的映射表（空表会先落到
     *         `empty_mapping` 而根本走不到 provider，那时断言 protocol 只会看到「零次调用」）。 */
    private Outbound captureOutbound(List<String> refs, String featuresJson, String channel) {
        return captureOutbound(refs, featuresJson, channel, "{}");
    }

    private Outbound captureOutbound(
            List<String> refs, String featuresJson, String channel, String requestMapping) {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", MODEL_ID,
                "size", "1024x1024", "aspect_ratio", "1:1",
                "provider_credential", "sealed-token"));
        if (!refs.isEmpty()) input.put("input_asset_ids", refs);
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = new GenerationModelCapabilityEntity();
        cap.setModelId(MODEL_ID);
        cap.setCapabilityType("image");
        cap.setApiSize("1024x1024");
        cap.setWidth(1024);
        cap.setHeight(1024);
        cap.setChannel(channel);
        cap.setRequestMapping(requestMapping);
        cap.setDefaultSize("1024x1024");
        cap.setDefaultAspectRatio("1:1");
        cap.setFeatures(featuresJson);
        when(capabilityMapper.findByModelId(MODEL_ID)).thenReturn(cap);

        if (!refs.isEmpty()) {
            Map<String, AssetEntity> byId = new HashMap<>();
            for (String id : refs) {
                AssetEntity asset = new AssetEntity();
                asset.setId(Long.parseLong(id));
                asset.setType("image");
                asset.setUrl("https://example.com/" + id + ".jpg");
                byId.put(id, asset);
            }
            when(assetSource.resolveInputAssets(anyList(), anyString(), anyString()))
                    .thenReturn(byId);
        }
        when(credentialService.open("sealed-token")).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(), anyString(),
                anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "stop after capture"));
        when(stateMachine.requeueImageJobForRetry(eq("100"), any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<ImageProtocol> protocolCaptor = ArgumentCaptor.forClass(ImageProtocol.class);
        ArgumentCaptor<String> modelCaptor = ArgumentCaptor.forClass(String.class);
        verify(imageClient).generate(anyString(), protocolCaptor.capture(), modelCaptor.capture(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList());
        return new Outbound(protocolCaptor.getValue(), modelCaptor.getValue());
    }

    // ========== 缺省 / inline 形态 ==========

    @Test
    @DisplayName("未声明协议（缺省）+ 别名 + 参考图 → 走 inline，出站 model 用别名")
    void defaultProtocolWithReferencesSwapsAlias() {
        Outbound out = captureOutbound(
                List.of("101"),
                "{\"i2i_model_name\": \"" + ALIAS + "\", \"image_reference_max\": 10}");
        assertThat(out.protocol()).isEqualTo(ImageProtocol.INLINE_IMAGE);
        assertThat(out.model()).isEqualTo(ALIAS);
    }

    @Test
    @DisplayName("inline 形态 + 别名 + 无参考图 → 出站 model 仍 canonical")
    void inlineAliasWithoutReferencesKeepsCanonical() {
        Outbound out = captureOutbound(
                List.of(), "{\"i2i_model_name\": \"" + ALIAS + "\"}");
        assertThat(out.protocol()).isEqualTo(ImageProtocol.INLINE_IMAGE);
        assertThat(out.model()).isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("inline 形态 + 未配别名 + 参考图 → canonical（单名行为不变）")
    void inlineNoAliasWithReferencesKeepsCanonical() {
        Outbound out = captureOutbound(
                List.of("101", "102"), "{\"image_reference_max\": 10}");
        assertThat(out.model()).isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("脏别名（空白串 / 非字符串 / features 损坏 JSON）→ 宽容降级 canonical")
    void dirtyAliasDegradesToCanonical() {
        assertThat(captureOutbound(List.of("101"), "{\"i2i_model_name\": \"  \"}").model())
                .isEqualTo(MODEL_ID);
        reset(stateMachine, assetSource, credentialService, imageClient, capabilityMapper);
        assertThat(captureOutbound(List.of("101"), "{\"i2i_model_name\": 42}").model())
                .isEqualTo(MODEL_ID);
        reset(stateMachine, assetSource, credentialService, imageClient, capabilityMapper);
        assertThat(captureOutbound(List.of("101"), "{broken json").model())
                .isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("camelCase 键形同样识别（与 TS toFeatures 双形兼容对齐）")
    void camelCaseAliasRecognized() {
        assertThat(captureOutbound(List.of("101"), "{\"i2iModelName\": \"" + ALIAS + "\"}").model())
                .isEqualTo(ALIAS);
    }

    // ========== 官方协议（渠道 gpt-image-openai） ==========

    /** 一张能解出尺寸的 gpt 交叉格（渠道是 gpt 系时必须给，否则先落 empty_mapping）。 */
    private static final String GPT_MATRIX = "{\"matrix\":{\"1024x1024\":{\"1:1\":\"2048x2048\"}}}";

    @Test
    @DisplayName("openai 渠道 + 参考图 → 出站 protocol 为官方协议，模型名恒 canonical 不换别名")
    void openAiProtocolIgnoresAlias() {
        Outbound out = captureOutbound(
                List.of("101"), "{\"i2i_model_name\": \"" + ALIAS + "\"}",
                "gpt-image-openai", GPT_MATRIX);
        assertThat(out.protocol()).isEqualTo(ImageProtocol.OPENAI_IMAGES);
        assertThat(out.model()).isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("openai 渠道 + 无参考图 → 同样是官方协议（端点由客户端按有无参考图选）")
    void openAiProtocolWithoutReferences() {
        Outbound out = captureOutbound(List.of(), "{}", "gpt-image-openai", GPT_MATRIX);
        assertThat(out.protocol()).isEqualTo(ImageProtocol.OPENAI_IMAGES);
        assertThat(out.model()).isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("内联 gpt 渠道（gpt-image）→ 仍走内联协议，与 openai 渠道是两个渠道")
    void inlineGptChannelStaysInline() {
        Outbound out = captureOutbound(List.of("101"), "{}", "gpt-image", GPT_MATRIX);
        assertThat(out.protocol()).isEqualTo(ImageProtocol.INLINE_IMAGE);
    }

    @Test
    @DisplayName("未知渠道值 → 按媒介回落 seedream-image（= 内联），与该媒介的缺省一致")
    void unknownChannelFallsBackToMediaDefault() {
        assertThat(captureOutbound(List.of(), "{}", "随便写的").protocol())
                .isEqualTo(ImageProtocol.INLINE_IMAGE);
    }

    @Test
    @DisplayName("渠道列为 NULL（回填不到的存量行）→ 同样按媒介回落，不静默变协议")
    void nullChannelFallsBackToMediaDefault() {
        assertThat(captureOutbound(List.of(), "{}", null).protocol())
                .isEqualTo(ImageProtocol.INLINE_IMAGE);
    }
}
