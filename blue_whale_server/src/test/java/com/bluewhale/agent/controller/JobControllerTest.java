package com.bluewhale.agent.controller;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.common.resp.SystemCode;
import com.bluewhale.agent.common.web.RestExceptionConfig;
import com.bluewhale.agent.model.dto.JobStatusResponse;
import com.bluewhale.agent.service.GenerationJobService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link JobController} 切片测试：mock service，验轮询 Result、GlobalException 转 code、SSE 501、webhook 收悉。
 */
@WebMvcTest(JobController.class)
@Import(RestExceptionConfig.class)
class JobControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private GenerationJobService generationJobService;

    @Test
    void getStatusProcessingReturnsResult() throws Exception {
        when(generationJobService.getJobStatus(eq(1L))).thenReturn(
                new JobStatusResponse(1L, "processing", 30, null));
        mockMvc.perform(get("/api/jobs/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.job_id").value(1))
                .andExpect(jsonPath("$.data.status").value("processing"))
                .andExpect(jsonPath("$.data.progress").value(30))
                .andExpect(jsonPath("$.data.asset").doesNotExist());
    }

    @Test
    void getStatusSucceededWithAsset() throws Exception {
        when(generationJobService.getJobStatus(eq(1L))).thenReturn(
                new JobStatusResponse(1L, "succeeded", 100,
                        new JobStatusResponse.AssetDto(5L, "/assets/v.mp4", "video")));
        mockMvc.perform(get("/api/jobs/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("succeeded"))
                .andExpect(jsonPath("$.data.asset.id").value(5))
                .andExpect(jsonPath("$.data.asset.url").value("/assets/v.mp4"))
                .andExpect(jsonPath("$.data.asset.type").value("video"));
    }

    @Test
    void getStatusNotFoundReturnsCode() throws Exception {
        when(generationJobService.getJobStatus(eq(99L)))
                .thenThrow(new GlobalException(SystemCode.NOT_FOUND_CODE, "job not found"));
        mockMvc.perform(get("/api/jobs/99"))
                .andExpect(jsonPath("$.code").value(SystemCode.NOT_FOUND_CODE))
                .andExpect(jsonPath("$.msg").value("job not found"));
    }

    @Test
    void streamReturns501() throws Exception {
        mockMvc.perform(get("/api/jobs/1/stream"))
                .andExpect(status().isNotImplemented());
    }

    @Test
    void arkWebhookAck() throws Exception {
        mockMvc.perform(post("/api/webhooks/ark")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.status").value("received"));
    }
}
