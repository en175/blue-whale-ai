package com.blue.whale.agent.service;

import com.blue.whale.agent.config.VolcEngineConfig;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskResult;
import com.volcengine.ark.runtime.service.ArkService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link VolcEngineService#createVideoTask} 单测：
 * 首帧/尾帧以 role=first_frame/last_frame 提交；全能参考以 reference_image/reference_video/reference_audio 提交。
 * 全 mock {@link ArkService}，不发网络。
 */
@ExtendWith(MockitoExtension.class)
class VolcEngineServiceTest {

    @Mock
    private ObjectProvider<ArkService> arkServiceProvider;
    @Mock
    private ArkService arkService;
    @Mock
    private VolcEngineConfig.ArkProperties arkProperties;
    @Mock
    private CreateContentGenerationTaskResult result;

    private VolcEngineService service;

    @BeforeEach
    void setUp() {
        service = new VolcEngineService(arkServiceProvider, arkProperties);
        when(arkServiceProvider.getIfAvailable()).thenReturn(arkService);
        when(arkService.createContentGenerationTask(any(CreateContentGenerationTaskRequest.class))).thenReturn(result);
    }

    /** 调 createVideoTask 并抓请求 contents；同时断言返回火山 task id。 */
    private List<CreateContentGenerationTaskRequest.Content> captureContents(
            String firstFrameUrl, String lastFrameUrl,
            List<String> refImages, List<String> refVideos, List<String> refAudios) {
        String taskId = service.createVideoTask("doubao-seedance-2-0-260128", "一只猫奔跑",
                firstFrameUrl, lastFrameUrl, refImages, refVideos, refAudios, "16:9", "720p", 5L);
        assertThat(taskId).isEqualTo("task-1");
        ArgumentCaptor<CreateContentGenerationTaskRequest> captor =
                ArgumentCaptor.forClass(CreateContentGenerationTaskRequest.class);
        verify(arkService).createContentGenerationTask(captor.capture());
        return captor.getValue().getContent();
    }

    private List<CreateContentGenerationTaskRequest.Content> elementsWithType(
            List<CreateContentGenerationTaskRequest.Content> contents, String type) {
        return contents.stream().filter(c -> type.equals(c.getType())).toList();
    }

    @Test
    void textToVideoHasOnlyTextElement() {
        when(result.getId()).thenReturn("task-1");
        List<CreateContentGenerationTaskRequest.Content> contents = captureContents(null, null, null, null, null);

        assertThat(contents).hasSize(1);
        assertThat(contents.get(0).getType()).isEqualTo("text");
        assertThat(elementsWithType(contents, "image_url")).isEmpty();
    }

    @Test
    void firstFrameOnlyHasRoleFirstFrame() {
        when(result.getId()).thenReturn("task-1");
        List<CreateContentGenerationTaskRequest.Content> contents =
                captureContents("https://tos/first.png", null, null, null, null);

        List<CreateContentGenerationTaskRequest.Content> images = elementsWithType(contents, "image_url");
        assertThat(images).hasSize(1);
        assertThat(images.get(0).getRole()).isEqualTo("first_frame");
    }

    @Test
    void firstAndLastFrameHaveDistinctRoles() {
        when(result.getId()).thenReturn("task-1");
        List<CreateContentGenerationTaskRequest.Content> contents =
                captureContents("https://tos/first.png", "https://tos/last.png", null, null, null);

        List<CreateContentGenerationTaskRequest.Content> images = elementsWithType(contents, "image_url");
        assertThat(images).hasSize(2);
        assertThat(images).extracting(CreateContentGenerationTaskRequest.Content::getRole)
                .containsExactly("first_frame", "last_frame");
    }

    @Test
    void omniReferenceBuildsReferenceRoles() {
        when(result.getId()).thenReturn("task-1");
        List<CreateContentGenerationTaskRequest.Content> contents = captureContents(null, null,
                List.of("https://tos/ref1.png", "https://tos/ref2.png"),
                List.of("https://tos/ref.mp4"),
                List.of("https://tos/bgm.mp3"));

        // 文本 + 2 参考图 + 1 参考视频 + 1 参考音频
        assertThat(contents).hasSize(5);
        assertThat(contents.get(0).getType()).isEqualTo("text");

        // 所有 image_url 元素均 reference_image，无 first_frame/last_frame
        List<CreateContentGenerationTaskRequest.Content> images = elementsWithType(contents, "image_url");
        assertThat(images).hasSize(2);
        assertThat(images).extracting(CreateContentGenerationTaskRequest.Content::getRole)
                .containsOnly("reference_image");

        // 参考视频 reference_video
        List<CreateContentGenerationTaskRequest.Content> videos = elementsWithType(contents, "video_url");
        assertThat(videos).hasSize(1);
        assertThat(videos.get(0).getRole()).isEqualTo("reference_video");

        // 参考音频 reference_audio
        List<CreateContentGenerationTaskRequest.Content> audios = elementsWithType(contents, "audio_url");
        assertThat(audios).hasSize(1);
        assertThat(audios.get(0).getRole()).isEqualTo("reference_audio");
    }
}
