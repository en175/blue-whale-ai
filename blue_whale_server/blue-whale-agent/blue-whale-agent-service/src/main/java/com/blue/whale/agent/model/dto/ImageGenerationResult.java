package com.blue.whale.agent.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 图片生成 Provider 结果：目前同步文生图只返回单张图片 URL，由业务层下载转存。
 */
@Getter
@AllArgsConstructor
public class ImageGenerationResult {

    private final String imageUrl;
}
