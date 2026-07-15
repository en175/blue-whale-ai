package com.blue.whale.agent.service;

import com.blue.whale.agent.model.entity.GenerationJob;

import java.util.Map;
import java.util.Set;

final class GenerationPublicError {

    private GenerationPublicError() {
    }

    static Map<String, Object> project(Map<String, Object> error, String type) {
        if (error == null) {
            return null;
        }
        Object rawCode = error.get("code");
        String fallbackCode = GenerationJob.TYPE_VIDEO.equals(type)
                ? "video_generation_failed" : "image_generation_failed";
        String code = rawCode == null ? fallbackCode : String.valueOf(rawCode);
        String message = switch (code) {
            case "submission_unknown" -> "无法确认视频任务是否已提交";
            case "timed_out" -> "视频生成超时";
            case "storage_failed" -> "生成结果存储失败";
            case "provider_failed" -> GenerationJob.TYPE_VIDEO.equals(type)
                    ? "视频生成失败" : "图像生成失败";
            case "no_result" -> "生成服务未返回结果";
            case "all_outputs_failed" -> "所有输出均生成失败";
            default -> GenerationJob.TYPE_VIDEO.equals(type) ? "视频生成失败" : "图像生成失败";
        };
        if (!Set.of("submission_unknown", "timed_out", "storage_failed", "provider_failed",
                        "no_result", "all_outputs_failed")
                .contains(code)) {
            code = fallbackCode;
        }
        return Map.of("code", code, "message", message);
    }
}
