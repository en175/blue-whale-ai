package com.bluewhale.agent.controller;

import com.bluewhale.agent.common.resp.SystemCode;
import com.bluewhale.agent.common.web.RestExceptionConfig;
import com.bluewhale.agent.model.dto.CreateJobResponse;
import com.bluewhale.agent.model.dto.ImageGenerateRequest;
import com.bluewhale.agent.model.dto.ImageGenerateResponse;
import com.bluewhale.agent.service.GenerationJobService;
import com.bluewhale.agent.service.GenerationModelCapabilityService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link GenerationController} 切片测试：mock service，验 Result 包装、X-User-Id 缺失 401、
 * @Valid 校验失败、snake_case 反序列化、模型列表返回、视频异步返 jobId。
 */
@WebMvcTest(GenerationController.class)
@Import(RestExceptionConfig.class)
class GenerationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GenerationJobService generationJobService;

    @MockitoBean
    private GenerationModelCapabilityService capabilityService;

    @Test
    void generateImageReturnsResult() throws Exception {
        when(generationJobService.createImageJob(any(), eq(7L)))
                .thenReturn(ImageGenerateResponse.sync(9L, "/assets/x.png"));
        mockMvc.perform(post("/api/generation/image")
                        .header("X-User-Id", "7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"cat\",\"model_id\":\"doubao-seedream-5-0-lite-250723\",\"size_id\":\"2k\",\"aspect_ratio\":\"1:1\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.asset_id").value(9))
                .andExpect(jsonPath("$.data.url").value("/assets/x.png"));
    }

    @Test
    void generateImageMissingUserIdReturns401() throws Exception {
        mockMvc.perform(post("/api/generation/image")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"cat\",\"model_id\":\"m\",\"size_id\":\"2k\"}"))
                .andExpect(jsonPath("$.code").value(SystemCode.UNAUTHORIZED_CODE));
    }

    @Test
    void generateImageBlankPromptReturnsParamError() throws Exception {
        mockMvc.perform(post("/api/generation/image")
                        .header("X-User-Id", "7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"\",\"model_id\":\"m\",\"size_id\":\"2k\"}"))
                .andExpect(jsonPath("$.code").value(SystemCode.PARAM_BIND_ERROR_CODE));
    }

    @Test
    void generateImageParsesSnakeCase() throws Exception {
        when(generationJobService.createImageJob(any(), eq(7L))).thenReturn(ImageGenerateResponse.sync(1L, "/x"));
        mockMvc.perform(post("/api/generation/image")
                        .header("X-User-Id", "7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"cat\",\"model_id\":\"doubao-seedream-5-0-lite-250723\",\"size_id\":\"2k\",\"aspect_ratio\":\"16:9\",\"quantity\":2}"))
                .andExpect(status().isOk());
        ArgumentCaptor<ImageGenerateRequest> captor = ArgumentCaptor.forClass(ImageGenerateRequest.class);
        verify(generationJobService).createImageJob(captor.capture(), eq(7L));
        assertThat(captor.getValue().modelId()).isEqualTo("doubao-seedream-5-0-lite-250723");
        assertThat(captor.getValue().sizeId()).isEqualTo("2k");
        assertThat(captor.getValue().aspectRatio()).isEqualTo("16:9");
        assertThat(captor.getValue().quantity()).isEqualTo(2);
    }

    @Test
    void listModelsReturnsCapabilities() throws Exception {
        mockMvc.perform(get("/api/generation/models?capability=image"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200));
        verify(capabilityService).listCapabilities("image");
    }

    @Test
    void generateVideoReturnsJobId() throws Exception {
        when(generationJobService.createVideoJob(any(), eq(7L)))
                .thenReturn(new CreateJobResponse(1L, "queued"));
        mockMvc.perform(post("/api/generation/video")
                        .header("X-User-Id", "7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"prompt\":\"cat video\",\"model_id\":\"vid-model\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.job_id").value(1))
                .andExpect(jsonPath("$.data.status").value("queued"));
    }
}
