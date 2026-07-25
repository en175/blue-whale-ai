package com.blue.whale.agent.controller;

import com.blue.whale.agent.model.dto.*;
import com.blue.whale.agent.service.GenerationModelCapabilityService;
import com.blue.whale.global.base.resp.Result;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 生成接口：生成模型能力查询。
 *
 * <p>响应统一 {@link Result} 包装；异常由 {@code RestExceptionConfig} 转 Result。
 * JSON 字段 snake_case（全局 Jackson SNAKE_CASE）。
 */
@Tag(name = "生成接口", description = "生成模型能力查询")
@RestController
@RequestMapping("/api/generation")
@RequiredArgsConstructor
public class GenerationController {

    private final GenerationModelCapabilityService capabilityService;

    /** 查询当前启用的图片生成模型及其能力。 */
    @GetMapping("/models")
    public Result<List<ImageModelCapabilityResponse>> listModels(
            @RequestParam(name = "capability", defaultValue = "image") String capability) {
        return Result.ok(capabilityService.listCapabilities(capability));
    }
}
