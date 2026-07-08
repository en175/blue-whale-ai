package com.bluewhale.agent.service;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.common.resp.SystemCode;
import com.bluewhale.agent.config.VolcEngineConfig;
import com.bluewhale.agent.model.dto.VideoTaskResult;
import com.volcengine.ApiException;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskResult;
import com.volcengine.ark.runtime.model.content.generation.GetContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.GetContentGenerationTaskResponse;
import com.volcengine.ark.runtime.model.images.generation.GenerateImagesRequest;
import com.volcengine.ark.runtime.model.images.generation.ImagesResponse;
import com.volcengine.ark.runtime.model.images.generation.ResponseFormat;
import com.volcengine.ark.runtime.service.ArkService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 火山方舟 Ark 调用封装：文生图同步 + 视频任务创建/查询。
 *
 * <p>ArkService 方法签名不 throws（内部 RxJava 阻塞，异常以 RuntimeException 透传），统一用
 * {@code catch(Exception)} 兜底，{@code instanceof ApiException} 取 code/body 记日志，转 {@link GlobalException}。
 * 通过 {@code ObjectProvider<ArkService>} 懒获取——无 ARK_API_KEY 时 bean 不存在，调用 {@link #requireArk()}
 * 抛配置缺失错误（不暴露 key）；裸启动不失败。model id 从配置读取，不硬编码。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VolcEngineService {

    private final ObjectProvider<ArkService> arkServiceProvider;
    private final VolcEngineConfig.ArkProperties arkProperties;

    /** 文生图同步生成，返回图片 url。 */
    public String generateImage(String prompt, String size, Boolean watermark) {
        ArkService arkService = requireArk();
        GenerateImagesRequest req = GenerateImagesRequest.builder()
                .model(arkProperties.getImageModel())
                .prompt(prompt)
                .responseFormat(ResponseFormat.Url)
                .size(size)
                .watermark(watermark)
                .build();
        try {
            ImagesResponse resp = arkService.generateImages(req);
            if (resp.getError() != null && resp.getError().getCode() != null) {
                log.warn("ark image moderation rejected: code={}, msg={}",
                        resp.getError().getCode(), resp.getError().getMessage());
                throw new GlobalException(SystemCode.CONTENT_MODERATION_REJECTED_CODE, resp.getError().getMessage());
            }
            if (resp.getData() == null || resp.getData().isEmpty()) {
                throw new GlobalException(SystemCode.FAILURE_CODE, "文生图返回空数据");
            }
            return resp.getData().get(0).getUrl();
        } catch (GlobalException e) {
            throw e;
        } catch (Exception e) {
            logArkError("generateImages", e);
            throw new GlobalException(SystemCode.FAILURE_CODE, "上游生成失败: " + rootMessage(e));
        }
    }

    /** 创建视频生成任务，返回火山 task id。 */
    public String createVideoTask(String prompt, String imageUrl, String ratio, String resolution, Long duration) {
        ArkService arkService = requireArk();
        List<CreateContentGenerationTaskRequest.Content> contents = new ArrayList<>();
        contents.add(CreateContentGenerationTaskRequest.Content.builder()
                .type("text")
                .text(prompt)
                .build());
        if (imageUrl != null && !imageUrl.isBlank()) {
            contents.add(CreateContentGenerationTaskRequest.Content.builder()
                    .type("image_url")
                    .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder().url(imageUrl).build())
                    .build());
        }
        CreateContentGenerationTaskRequest.Builder builder = CreateContentGenerationTaskRequest.builder()
                .model(arkProperties.getVideoModel())
                .content(contents);
        if (ratio != null && !ratio.isBlank()) {
            builder.ratio(ratio);
        }
        if (resolution != null && !resolution.isBlank()) {
            builder.resolution(resolution);
        }
        if (duration != null) {
            builder.duration(duration);
        }
        CreateContentGenerationTaskRequest req = builder.build();
        try {
            CreateContentGenerationTaskResult result = arkService.createContentGenerationTask(req);
            return result.getId();
        } catch (Exception e) {
            logArkError("createContentGenerationTask", e);
            throw new GlobalException(SystemCode.FAILURE_CODE, "上游创建任务失败: " + rootMessage(e));
        }
    }

    /** 查询视频任务状态，返回 status/videoUrl/error。 */
    public VideoTaskResult getVideoTask(String taskId) {
        ArkService arkService = requireArk();
        GetContentGenerationTaskRequest req = GetContentGenerationTaskRequest.builder().taskId(taskId).build();
        try {
            GetContentGenerationTaskResponse resp = arkService.getContentGenerationTask(req);
            String videoUrl = resp.getContent() != null ? resp.getContent().getVideoUrl() : null;
            String errorCode = resp.getError() != null ? resp.getError().getCode() : null;
            String errorMsg = resp.getError() != null ? resp.getError().getMessage() : null;
            return new VideoTaskResult(resp.getStatus(), videoUrl, errorCode, errorMsg);
        } catch (Exception e) {
            logArkError("getContentGenerationTask", e);
            throw new GlobalException(SystemCode.FAILURE_CODE, "上游查询任务失败: " + rootMessage(e));
        }
    }

    /** 懒获取 ArkService bean；无 ARK_API_KEY 时 bean 不存在，抛配置缺失错误（不暴露 key）。 */
    private ArkService requireArk() {
        ArkService arkService = arkServiceProvider.getIfAvailable();
        if (arkService == null) {
            throw new GlobalException(SystemCode.FAILURE_CODE, "ARK_API_KEY 未配置");
        }
        return arkService;
    }

    private void logArkError(String op, Exception e) {
        if (e instanceof ApiException ae) {
            log.error("ark {} failed: code={}, body={}", op, ae.getCode(), ae.getResponseBody(), ae);
        } else {
            log.error("ark {} failed", op, e);
        }
    }

    private String rootMessage(Exception e) {
        Throwable cur = e;
        while (cur.getCause() != null && cur.getCause() != cur) {
            cur = cur.getCause();
        }
        return cur.getMessage();
    }
}
