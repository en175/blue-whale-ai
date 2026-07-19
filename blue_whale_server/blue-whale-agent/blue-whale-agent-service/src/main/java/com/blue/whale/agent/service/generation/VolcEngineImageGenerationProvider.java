package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.dto.AssetContent;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.service.ProjectAssetContentService;
import com.blue.whale.global.exception.GlobalException;
import com.volcengine.ApiException;
import com.volcengine.ark.runtime.model.images.generation.GenerateImagesRequest;
import com.volcengine.ark.runtime.model.images.generation.GenerateImagesRequest.ContentGenerationTool;
import com.volcengine.ark.runtime.model.images.generation.ImagesResponse;
import com.volcengine.ark.runtime.model.images.generation.ResponseFormat;
import com.volcengine.ark.runtime.service.ArkService;
import org.springframework.beans.factory.ObjectProvider;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 火山方舟 Agent Plan 文生图 Provider：{@code mode=agent-plan} 下 GenerationWorker 经本类
 * 真实调用方舟 {@code /plan/v3/images/generations}（ArkService bean base-url 已由
 * GenerationAdapterConfiguration 校验含 {@code /plan/}）。
 *
 * <p>支持文生图 + 参考图（image 参数：先从项目 Asset 存储读出 bytes 转 base64 data URL 透传，
 * 免外部可读 URL）+ 联网搜索（{@code tools=[{type=web_search}]}）；响应用 {@code b64_json}
 * 免二次下载。按 {@link GenerationModelCapability} 能力表路由 {@code model_id}（Agent 路径缺省时
 * 回落 enabled image 默认模型）并校验 size 白名单；非法 model/size fail-closed 返回明确错误，
 * 不再透传到方舟（避免产生付费调用）。
 *
 * <p>单次只产出一张图：组图由 Job 多 slot（{@code expected_output_count}）多次 generate 承载，
 * 故不装配 sequential_image_generation/max_images（能力表已声明该能力供后续单次多图扩展）。
 */
public class VolcEngineImageGenerationProvider implements GenerationProvider {

    private static final int MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    private static final int MAX_REFERENCE_IMAGES = 4;
    private static final String WEB_SEARCH_TOOL_TYPE = "web_search";

    private final ObjectProvider<ArkService> arkServiceProvider;
    private final ProjectAssetContentService assetContentService;
    private final GenerationModelCapabilityMapper capabilityMapper;

    public VolcEngineImageGenerationProvider(
            ObjectProvider<ArkService> arkServiceProvider,
            ProjectAssetContentService assetContentService,
            GenerationModelCapabilityMapper capabilityMapper) {
        this.arkServiceProvider = arkServiceProvider;
        this.assetContentService = assetContentService;
        this.capabilityMapper = capabilityMapper;
    }

    @Override
    public GenerationProviderResult generate(GenerationProviderRequest request) {
        Map<String, Object> input = request == null ? null : request.input();
        if (input == null
                || !(input.get("prompt") instanceof String prompt)
                || prompt.isBlank()) {
            return GenerationProviderResult.failure("invalid_request", "图片生成参数缺失");
        }
        String requestedModelId = input.get("model_id") instanceof String model
                && !model.isBlank() ? model : null;
        GenerationModelCapability capability = resolveCapability(requestedModelId);
        if (capability == null) {
            return GenerationProviderResult.failure("model_unavailable", "未开通或不受支持的模型");
        }
        String apiSize = resolveApiSize(input.get("size"), capability);
        if (apiSize == null) {
            return GenerationProviderResult.failure("invalid_size", "模型不支持该尺寸");
        }
        Boolean webSearch = input.get("web_search") instanceof Boolean flag ? flag : null;
        List<String> referenceDataUrls = resolveReferenceDataUrls(request, input, capability);
        if (referenceDataUrls == null) {
            return GenerationProviderResult.failure("reference_image_unavailable", "参考资源不可用");
        }
        ArkService arkService = arkServiceProvider.getIfAvailable();
        if (arkService == null) {
            return GenerationProviderResult.failure(
                    "provider_not_configured", "图片生成服务暂不可用");
        }
        GenerateImagesRequest arkRequest = buildRequest(
                capability.getModelId(), prompt, apiSize, webSearch, referenceDataUrls);
        try {
            return toResult(arkService.generateImages(arkRequest));
        } catch (Exception exception) {
            return providerFailure(exception);
        }
    }

    private GenerationModelCapability resolveCapability(String requestedModelId) {
        if (requestedModelId != null) {
            return capabilityMapper.selectEnabledByModelId(requestedModelId).orElse(null);
        }
        // Agent 路径不暴露模型选择：回落能力表第一行 enabled image 模型（能力表为唯一权威）。
        List<GenerationModelCapability> enabled =
                capabilityMapper.selectEnabledByCapabilityType(GenerationModelCapability.CAPABILITY_IMAGE);
        return enabled.isEmpty() ? null : enabled.get(0);
    }

    private String resolveApiSize(Object sizeValue, GenerationModelCapability capability) {
        String sizeId = sizeValue instanceof String value && !value.isBlank()
                ? value : capability.getDefaultSize();
        GenerationModelCapability.SizeOption option = capability.findSizeById(sizeId);
        return option == null ? null : option.getApiValue();
    }

    private List<String> resolveReferenceDataUrls(
            GenerationProviderRequest request, Map<String, Object> input,
            GenerationModelCapability capability) {
        Object value = input.get("reference_asset_ids");
        if (!(value instanceof List<?> list) || list.isEmpty()) {
            return List.of();
        }
        GenerationModelCapability.Features features = capability.getFeatures();
        if (features == null || !Boolean.TRUE.equals(features.getReferenceImage())) {
            return null;
        }
        if (list.size() > MAX_REFERENCE_IMAGES) {
            return null;
        }
        List<String> dataUrls = new ArrayList<>(list.size());
        for (Object item : list) {
            if (!(item instanceof Number number)) {
                return null;
            }
            long assetId = number.longValue();
            if (assetId <= 0 || number.doubleValue() != (double) assetId) {
                return null;
            }
            try {
                AssetContent asset = assetContentService.read(
                        request.projectId(), assetId, request.userId());
                if (asset == null || asset.content() == null || asset.content().length == 0) {
                    return null;
                }
                dataUrls.add(dataUrl(asset));
            } catch (GlobalException exception) {
                return null;
            }
        }
        return dataUrls;
    }

    private GenerateImagesRequest buildRequest(
            String modelId, String prompt, String apiSize,
            Boolean webSearch, List<String> referenceDataUrls) {
        GenerateImagesRequest.Builder builder = GenerateImagesRequest.builder()
                .model(modelId)
                .prompt(prompt)
                .size(apiSize)
                .outputFormat("png")
                .responseFormat(ResponseFormat.Base64)
                .watermark(false)
                .stream(false);
        if (!referenceDataUrls.isEmpty()) {
            builder.image(referenceDataUrls);
        }
        if (Boolean.TRUE.equals(webSearch)) {
            ContentGenerationTool tool = new ContentGenerationTool();
            tool.setType(WEB_SEARCH_TOOL_TYPE);
            builder.tools(List.of(tool));
        }
        return builder.build();
    }

    private GenerationProviderResult toResult(ImagesResponse response) {
        if (response == null || response.getData() == null || response.getData().isEmpty()) {
            return GenerationProviderResult.noResult();
        }
        String base64 = response.getData().get(0).getB64Json();
        if (base64 == null || base64.isBlank()) {
            return GenerationProviderResult.noResult();
        }
        return decode(base64);
    }

    private GenerationProviderResult decode(String base64) {
        if ((long) base64.length() * 3 / 4 > MAX_IMAGE_BYTES) {
            return GenerationProviderResult.failure(
                    "invalid_provider_result", "图片生成结果超过大小限制");
        }
        byte[] content;
        try {
            content = Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException exception) {
            return GenerationProviderResult.failure(
                    "invalid_provider_result", "图片生成结果格式无效");
        }
        if (content.length == 0 || content.length > MAX_IMAGE_BYTES) {
            return GenerationProviderResult.failure(
                    "invalid_provider_result", "图片生成结果超过大小限制");
        }
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(content));
            if (image == null) {
                return GenerationProviderResult.failure(
                        "invalid_provider_result", "图片生成结果格式无效");
            }
            return GenerationProviderResult.success(content, "image/png",
                    image.getWidth(), image.getHeight());
        } catch (IOException exception) {
            return GenerationProviderResult.failure(
                    "invalid_provider_result", "图片生成结果格式无效");
        }
    }

    private GenerationProviderResult providerFailure(Exception exception) {
        if (exception instanceof ApiException apiException) {
            int code = apiException.getCode();
            if (code == 401 || code == 403) {
                return GenerationProviderResult.failure(
                        "provider_auth_failed", "图片生成服务认证失败");
            }
            if (code == 429) {
                return GenerationProviderResult.failure(
                        "provider_rate_limited", "图片生成服务请求过于频繁");
            }
            if (code >= 500) {
                return GenerationProviderResult.failure(
                        "provider_unavailable", "图片生成服务暂不可用");
            }
            return GenerationProviderResult.failure(
                    "provider_rejected", "图片生成请求被服务拒绝");
        }
        return GenerationProviderResult.failure(
                "provider_unavailable", "图片生成服务暂不可用");
    }

    private String dataUrl(AssetContent asset) {
        String mime = asset.mimeType() == null || asset.mimeType().isBlank()
                ? "image/png" : asset.mimeType().toLowerCase(Locale.ROOT);
        return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(asset.content());
    }
}
