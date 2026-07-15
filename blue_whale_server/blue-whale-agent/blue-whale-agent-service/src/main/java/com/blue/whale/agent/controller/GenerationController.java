package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.*;
import com.blue.whale.agent.service.GenerationJobService;
import com.blue.whale.agent.service.GenerationModelCapabilityService;
import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;
import java.util.List;

/**
 * 生成接口：保留生成流页使用的文生图入口。
 *
 * <p>用户身份走 {@code X-User-Id} 请求头（MVP 无鉴权，前端直传）。
 * 响应统一 {@link Result} 包装；异常由 {@code RestExceptionConfig} 转 Result。
 * JSON 字段 snake_case（全局 Jackson SNAKE_CASE）。
 */
@Tag(name = "生成接口", description = "文生图（Seedream 同步）")
@RestController
@RequestMapping("/api/generation")
@RequiredArgsConstructor
public class GenerationController {

    private final GenerationJobService generationJobService;
    private final GenerationModelCapabilityService capabilityService;

    /** 查询当前启用的图片生成模型及其能力。 */
    @GetMapping("/models")
    public Result<List<ImageModelCapabilityResponse>> listModels(
            @RequestParam(name = "capability", defaultValue = "image") String capability) {
        return Result.ok(capabilityService.listCapabilities(capability));
    }

    /** 文生图：流式模型返 job_id（前端 EventSource 订阅逐张），非流式返 asset_id+url。 */
    @PostMapping("/image")
    public Result<ImageGenerateResponse> generateImage(@RequestHeader(value = "X-User-Id", required = false) Long userId,
                                                       @RequestHeader(value = "X-Input-Request-Id", required = false) Long inputRequestId,
                                                       @RequestBody @Valid ImageGenerateRequest req) {
        return Result.ok(generationJobService.createImageJob(
                req, requireUserId(userId), inputRequestId));
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "缺少 X-User-Id 请求头");
        }
        return userId;
    }
}
