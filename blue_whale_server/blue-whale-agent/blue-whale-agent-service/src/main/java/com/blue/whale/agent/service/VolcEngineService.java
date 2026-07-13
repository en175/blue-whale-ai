package com.blue.whale.agent.service;

import com.blue.whale.agent.config.VolcEngineConfig;
import com.blue.whale.agent.model.dto.ImageGenerationResult;
import com.blue.whale.agent.model.dto.ProviderImageGenerationRequest;
import com.blue.whale.agent.model.dto.VideoTaskResult;
import com.blue.whale.agent.service.provider.ImageGenerationProvider;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.volcengine.ApiException;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskResult;
import com.volcengine.ark.runtime.model.content.generation.GetContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.GetContentGenerationTaskResponse;
import com.volcengine.ark.runtime.model.images.generation.GenerateImagesRequest;
import com.volcengine.ark.runtime.model.images.generation.ImageGenStreamEvent;
import com.volcengine.ark.runtime.model.images.generation.ImagesResponse;
import com.volcengine.ark.runtime.model.images.generation.ResponseFormat;
import com.volcengine.ark.runtime.service.ArkService;
import io.reactivex.Flowable;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 火山方舟 Ark 调用封装：文生图同步 + 视频任务创建/查询。
 *
 * <p>当前类同时实现 {@link ImageGenerationProvider}，作为多模型 Provider 架构中火山的具体实现。
 * 文生图/视频的 model 均由调用方传入；配置仅保留 base-url 与 api-key。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VolcEngineService implements ImageGenerationProvider {

    public static final String PROVIDER_ID = "volcengine";

    private final ObjectProvider<ArkService> arkServiceProvider;
    private final VolcEngineConfig.ArkProperties arkProperties;

    @Override
    public String getProviderId() {
        return PROVIDER_ID;
    }

    /** 火山图片生成支持流式。 */
    @Override
    public boolean supportsStreaming() {
        return true;
    }

    /** 文生图同步生成，按模型能力透传支持的字段。 */
    @Override
    public ImageGenerationResult generate(ProviderImageGenerationRequest req) {
        ArkService arkService = requireArk();
        GenerateImagesRequest request = buildArkRequest(req);
        try {
            ImagesResponse resp = arkService.generateImages(request);
            if (resp.getError() != null && resp.getError().getCode() != null) {
                log.warn("ark image moderation rejected: code={}, msg={}",
                        resp.getError().getCode(), resp.getError().getMessage());
                throw new GlobalException(SystemCode.CONTENT_MODERATION_REJECTED_CODE, resp.getError().getMessage());
            }
            if (resp.getData() == null || resp.getData().isEmpty()) {
                throw new GlobalException(SystemCode.FAILURE_CODE, "文生图返回空数据");
            }
            return new ImageGenerationResult(resp.getData().get(0).getUrl());
        } catch (GlobalException e) {
            throw e;
        } catch (Exception e) {
            logArkError("generateImages", e);
            throw new GlobalException(SystemCode.FAILURE_CODE, "上游生成失败: " + rootMessage(e));
        }
    }

    /** 流式文生图，返回事件流；Ark SDK 内部 setStream(true)。 */
    @Override
    public Flowable<ImageGenStreamEvent> streamGenerateImages(ProviderImageGenerationRequest req) {
        ArkService arkService = requireArk();
        return arkService.streamGenerateImages(buildArkRequest(req));
    }

    /** 构建火山 Ark 图片生成请求，同步与流式两条路径复用。 */
    private GenerateImagesRequest buildArkRequest(ProviderImageGenerationRequest req) {
        GenerateImagesRequest.Builder builder = GenerateImagesRequest.builder()
                .model(req.getModelId())
                .prompt(req.getPrompt())
                .responseFormat(ResponseFormat.Url)
                .size(req.getSize());

        if (req.getOutputFormat() != null && !req.getOutputFormat().isBlank()) {
            builder.outputFormat(req.getOutputFormat());
        }
        if (req.getReferenceImages() != null && !req.getReferenceImages().isEmpty()) {
            builder.image(req.getReferenceImages());
        }
        if (req.getWatermark() != null) {
            builder.watermark(req.getWatermark());
        }
        if (req.getSequentialImageGeneration() != null && req.getSequentialImageGeneration()) {
            builder.sequentialImageGeneration("auto");
        }
        if (req.getStream() != null) {
            builder.stream(req.getStream());
        }
        if (req.getTools() != null && req.getTools()) {
            GenerateImagesRequest.ContentGenerationTool tool = new GenerateImagesRequest.ContentGenerationTool();
            tool.setType("web_search");
            builder.tools(Collections.singletonList(tool));
        }
        return builder.build();
    }

    /** 创建视频生成任务，返回火山 task id。 */
    public String createVideoTask(String model, String prompt, String imageUrl, String ratio, String resolution, Long duration) {
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
                .model(model)
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
            throw new GlobalException("ARK_API_KEY 未配置");
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
