package com.bluewhale.agent.service;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.config.VolcEngineConfig;
import com.bluewhale.agent.model.dto.ImageGenerationResult;
import com.bluewhale.agent.model.dto.ProviderImageGenerationRequest;
import com.bluewhale.agent.model.dto.VideoTaskResult;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskResult;
import com.volcengine.ark.runtime.model.content.generation.GetContentGenerationTaskResponse;
import com.volcengine.ark.runtime.model.images.generation.ImagesResponse;
import com.volcengine.ark.runtime.service.ArkService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * {@link VolcEngineService} 测试：mock {@link ObjectProvider}<{@link ArkService}>，
 * 覆盖正常/审核拒绝/空数据/异常/密钥缺失 + 视频创建/查询各状态。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class VolcEngineServiceTest {

    @Mock
    private ArkService arkService;
    @Mock
    private ObjectProvider<ArkService> arkServiceProvider;
    @Mock
    private VolcEngineConfig.ArkProperties arkProperties;

    @InjectMocks
    private VolcEngineService service;

    @BeforeEach
    void setUp() {
        when(arkServiceProvider.getIfAvailable()).thenReturn(arkService);
        when(arkProperties.getVideoModel()).thenReturn("vid-model");
    }

    private ProviderImageGenerationRequest imageReq(String prompt, String size) {
        return ProviderImageGenerationRequest.builder()
                .modelId("img-model")
                .prompt(prompt)
                .size(size)
                .build();
    }

    @Test
    void generateImageReturnsUrl() {
        ImagesResponse resp = new ImagesResponse();
        ImagesResponse.Image img = new ImagesResponse.Image();
        img.setUrl("https://ark/img.png");
        resp.setData(List.of(img));
        when(arkService.generateImages(any())).thenReturn(resp);

        ImageGenerationResult result = service.generate(imageReq("a cat", "1024x1024"));
        assertThat(result.getImageUrl()).isEqualTo("https://ark/img.png");
    }

    @Test
    void generateImageModerationRejected() {
        ImagesResponse resp = new ImagesResponse();
        ImagesResponse.Error err = new ImagesResponse.Error();
        err.setCode("moderation_blocked");
        err.setMessage("内容违规");
        resp.setError(err);
        when(arkService.generateImages(any())).thenReturn(resp);

        assertThatThrownBy(() -> service.generate(imageReq("xxx", "1024x1024")))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("内容违规");
    }

    @Test
    void generateImageEmptyDataThrows() {
        ImagesResponse resp = new ImagesResponse();
        resp.setData(List.of());
        when(arkService.generateImages(any())).thenReturn(resp);

        assertThatThrownBy(() -> service.generate(imageReq("x", "1x1")))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("空数据");
    }

    @Test
    void generateImageUpstreamExceptionWrapped() {
        when(arkService.generateImages(any())).thenThrow(new RuntimeException("boom"));

        assertThatThrownBy(() -> service.generate(imageReq("x", "1x1")))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("上游生成失败")
                .hasMessageContaining("boom");
    }

    @Test
    void apiKeyMissingThrowsConfigError() {
        when(arkServiceProvider.getIfAvailable()).thenReturn(null);

        assertThatThrownBy(() -> service.generate(imageReq("x", "1x1")))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("ARK_API_KEY");
    }

    @Test
    void createVideoTaskReturnsId() {
        when(arkService.createContentGenerationTask(any()))
                .thenReturn(new CreateContentGenerationTaskResult("task-123"));

        assertThat(service.createVideoTask("prompt", null, "16:9", "720p", 5L))
                .isEqualTo("task-123");
    }

    @Test
    void createVideoTaskWithImageUrl() {
        when(arkService.createContentGenerationTask(any()))
                .thenReturn(new CreateContentGenerationTaskResult("task-img"));

        assertThat(service.createVideoTask("prompt", "https://img/x.png", "16:9", null, null))
                .isEqualTo("task-img");
    }

    @Test
    void createVideoTaskUpstreamExceptionWrapped() {
        when(arkService.createContentGenerationTask(any())).thenThrow(new RuntimeException("create-fail"));

        assertThatThrownBy(() -> service.createVideoTask("p", null, null, null, null))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("上游创建任务失败");
    }

    @Test
    void getVideoTaskRunningHasNoVideoUrl() {
        GetContentGenerationTaskResponse resp = new GetContentGenerationTaskResponse();
        resp.setStatus("running");
        when(arkService.getContentGenerationTask(any())).thenReturn(resp);

        VideoTaskResult r = service.getVideoTask("task-1");
        assertThat(r.status()).isEqualTo("running");
        assertThat(r.videoUrl()).isNull();
    }

    @Test
    void getVideoTaskSucceededHasVideoUrl() {
        GetContentGenerationTaskResponse resp = new GetContentGenerationTaskResponse();
        resp.setStatus("succeeded");
        GetContentGenerationTaskResponse.Content c = new GetContentGenerationTaskResponse.Content();
        c.setVideoUrl("https://ark/v.mp4");
        resp.setContent(c);
        when(arkService.getContentGenerationTask(any())).thenReturn(resp);

        VideoTaskResult r = service.getVideoTask("task-1");
        assertThat(r.status()).isEqualTo("succeeded");
        assertThat(r.videoUrl()).isEqualTo("https://ark/v.mp4");
    }

    @Test
    void getVideoTaskFailedHasError() {
        GetContentGenerationTaskResponse resp = new GetContentGenerationTaskResponse();
        resp.setStatus("failed");
        GetContentGenerationTaskResponse.ContentGenerationError err =
                new GetContentGenerationTaskResponse.ContentGenerationError();
        err.setCode("balance_insufficient");
        err.setMessage("余额不足");
        resp.setError(err);
        when(arkService.getContentGenerationTask(any())).thenReturn(resp);

        VideoTaskResult r = service.getVideoTask("task-1");
        assertThat(r.status()).isEqualTo("failed");
        assertThat(r.errorCode()).isEqualTo("balance_insufficient");
        assertThat(r.errorMsg()).isEqualTo("余额不足");
    }
}
