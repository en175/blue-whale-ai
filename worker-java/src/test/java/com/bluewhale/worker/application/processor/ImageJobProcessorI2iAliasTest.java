package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
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
 * 图生图别名分流测试（契约 §11 / ADR-0085，IKESD6）。
 * <p>
 * 规格：行配了 features.i2i_model_name **且** 本 job 带参考图 → 出站 HTTP body 的
 * model 用别名；否则用 capability.model_id（canonical）。canonical 不变量：
 * 只换出站请求字段，job.input.model_id 不动。
 * <p>
 * 断言方式：generate stub 抛 provider_failed（retry_count=0 → requeue，不触发转存），
 * 用 ArgumentCaptor 钉住出站 model 实参。
 */
@ExtendWith(MockitoExtension.class)
class ImageJobProcessorI2iAliasTest {

    private static final String MODEL_ID = "gpt-image-2-text-to-image";
    private static final String ALIAS = "gpt-image-2-edit";

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetSourceService assetSource;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiImageClient imageClient;
    @Mock private GenerationModelCapabilityMapper capabilityMapper;
    @Mock private TosMediaStorage tosService;

    private ImageJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new ImageJobProcessor(
                stateMachine, assetSource, credentialService,
                imageClient, capabilityMapper, tosService);
    }

    private String captureOutboundModel(List<String> refs, String featuresJson) {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", MODEL_ID,
                "provider_credential", "sealed-token"));
        if (!refs.isEmpty()) input.put("input_asset_ids", refs);
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = new GenerationModelCapabilityEntity();
        cap.setModelId(MODEL_ID);
        cap.setApiSize("1024x1024");
        cap.setWidth(1024);
        cap.setHeight(1024);
        cap.setChannelParser("seedream");
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
        when(imageClient.generate(anyString(), anyString(), anyString(), anyInt(),
                any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "stop after capture"));
        when(stateMachine.requeueImageJobForRetry(eq("100"), any())).thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<String> modelCaptor = ArgumentCaptor.forClass(String.class);
        verify(imageClient).generate(anyString(), modelCaptor.capture(), anyString(),
                anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList());
        return modelCaptor.getValue();
    }

    @Test
    @DisplayName("配了别名 + 带参考图 → 出站 model 用图生图别名")
    void aliasWithReferencesSwaps() {
        String model = captureOutboundModel(
                List.of("101"),
                "{\"i2i_model_name\": \"" + ALIAS + "\", \"max_reference_images\": 10}");
        assertThat(model).isEqualTo(ALIAS);
    }

    @Test
    @DisplayName("配了别名 + 无参考图 → 出站 model 仍 canonical")
    void aliasWithoutReferencesKeepsCanonical() {
        String model = captureOutboundModel(
                List.of(), "{\"i2i_model_name\": \"" + ALIAS + "\"}");
        assertThat(model).isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("未配别名 + 带参考图 → canonical（单名行为不变）")
    void noAliasWithReferencesKeepsCanonical() {
        String model = captureOutboundModel(
                List.of("101", "102"), "{\"max_reference_images\": 10}");
        assertThat(model).isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("脏别名（空白串 / 非字符串 / features 损坏 JSON）→ 宽容降级 canonical")
    void dirtyAliasDegradesToCanonical() {
        assertThat(captureOutboundModel(List.of("101"), "{\"i2i_model_name\": \"  \"}"))
                .isEqualTo(MODEL_ID);
        reset(stateMachine, assetSource, credentialService, imageClient, capabilityMapper);
        assertThat(captureOutboundModel(List.of("101"), "{\"i2i_model_name\": 42}"))
                .isEqualTo(MODEL_ID);
        reset(stateMachine, assetSource, credentialService, imageClient, capabilityMapper);
        assertThat(captureOutboundModel(List.of("101"), "{broken json"))
                .isEqualTo(MODEL_ID);
    }

    @Test
    @DisplayName("camelCase 键形同样识别（与 TS toFeatures 双形兼容对齐）")
    void camelCaseAliasRecognized() {
        String model = captureOutboundModel(
                List.of("101"), "{\"i2iModelName\": \"" + ALIAS + "\"}");
        assertThat(model).isEqualTo(ALIAS);
    }
}
