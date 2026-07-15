package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.model.dto.AssetContent;
import com.blue.whale.agent.service.ProjectAssetContentService;
import com.blue.whale.global.exception.GlobalException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class OpenAiImageGenerationProvider implements GenerationProvider {

    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final Set<String> LANDSCAPE_RATIOS = Set.of("16:9", "4:3", "3:2", "21:9");
    private static final Set<String> PORTRAIT_RATIOS = Set.of("9:16", "3:4", "2:3");

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final ProjectAssetContentService assetContentService;
    private final GenerationAdapterProperties properties;

    public OpenAiImageGenerationProvider(
            OkHttpClient httpClient,
            ObjectMapper objectMapper,
            ProjectAssetContentService assetContentService,
            GenerationAdapterProperties properties) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.assetContentService = assetContentService;
        this.properties = properties;
    }

    @Override
    public GenerationProviderResult generate(GenerationProviderRequest request) {
        try {
            validateRequest(request);
            Map<String, Object> input = request.input();
            List<Long> referenceAssetIds = referenceAssetIds(input);
            Request httpRequest = referenceAssetIds.isEmpty()
                    ? generationRequest(input)
                    : editRequest(request, referenceAssetIds);
            try (Response response = httpClient.newCall(httpRequest).execute()) {
                ResponseBody responseBody = response.body();
                if (!response.isSuccessful() || responseBody == null) {
                    return providerFailure(response.code(), responseBody);
                }
                JsonNode data = objectMapper.readTree(responseBody.byteStream()).path("data");
                if (!data.isArray() || data.isEmpty()) {
                    return GenerationProviderResult.noResult();
                }
                String base64 = data.get(0).path("b64_json").asText();
                if (base64.isBlank()) {
                    return GenerationProviderResult.noResult();
                }
                return decodePng(base64);
            }
        } catch (InvalidRequestException exception) {
            return GenerationProviderResult.failure("invalid_request", "图片生成参数无效");
        } catch (GlobalException exception) {
            return GenerationProviderResult.failure(
                    "reference_asset_unavailable", "参考资源不可用");
        } catch (IOException | IllegalArgumentException exception) {
            return GenerationProviderResult.failure("provider_unavailable", "图片生成服务暂不可用");
        }
    }

    private GenerationProviderResult providerFailure(int status, ResponseBody responseBody) throws IOException {
        if (status == 401 || status == 403) {
            return GenerationProviderResult.failure("provider_auth_failed", "图片生成服务认证失败");
        }
        if (status == 429) {
            return GenerationProviderResult.failure("provider_rate_limited", "图片生成服务请求过于频繁");
        }
        if (status >= 500) {
            return GenerationProviderResult.failure("provider_unavailable", "图片生成服务暂不可用");
        }
        String providerCode = "";
        if (responseBody != null) {
            JsonNode error = objectMapper.readTree(responseBody.byteStream()).path("error");
            providerCode = error.path("code").asText("");
        }
        if (providerCode.contains("moderation") || providerCode.contains("content_policy")) {
            return GenerationProviderResult.failure("provider_moderation_rejected", "图片生成请求未通过内容安全检查");
        }
        return GenerationProviderResult.failure("provider_rejected", "图片生成请求被服务拒绝");
    }

    private Request generationRequest(Map<String, Object> input) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", properties.getOpenai().getModel());
        body.put("prompt", String.valueOf(input.get("prompt")));
        body.put("size", imageSize(String.valueOf(input.getOrDefault("aspect_ratio", "1:1"))));
        body.put("output_format", "png");
        body.put("n", 1);

        return new Request.Builder()
                .url(trimTrailingSlash(properties.getOpenai().getBaseUrl()) + "/v1/images/generations")
                .header("Authorization", "Bearer " + properties.getOpenai().getApiKey())
                .post(RequestBody.create(body.toString(), JSON))
                .build();
    }

    private Request editRequest(GenerationProviderRequest request, List<Long> referenceAssetIds) {
        Map<String, Object> input = request.input();
        MultipartBody.Builder body = new MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("model", properties.getOpenai().getModel())
                .addFormDataPart("prompt", String.valueOf(input.get("prompt")))
                .addFormDataPart("size", imageSize(String.valueOf(input.getOrDefault("aspect_ratio", "1:1"))))
                .addFormDataPart("output_format", "png")
                .addFormDataPart("n", "1");
        for (Long assetId : referenceAssetIds) {
            AssetContent asset = assetContentService.read(request.projectId(), assetId, request.userId());
            MediaType mediaType = MediaType.parse(asset.mimeType());
            body.addFormDataPart(
                    "image[]",
                    "asset-" + assetId + ".png",
                    RequestBody.create(asset.content(), mediaType));
        }
        return new Request.Builder()
                .url(trimTrailingSlash(properties.getOpenai().getBaseUrl()) + "/v1/images/edits")
                .header("Authorization", "Bearer " + properties.getOpenai().getApiKey())
                .post(body.build())
                .build();
    }

    private List<Long> referenceAssetIds(Map<String, Object> input) {
        Object value = input.get("reference_asset_ids");
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().map(item -> ((Number) item).longValue()).toList();
    }

    private void validateRequest(GenerationProviderRequest request) {
        if (request == null || request.input() == null
                || !(request.input().get("prompt") instanceof String prompt)
                || prompt.isBlank()) {
            throw new InvalidRequestException();
        }
        Object value = request.input().get("reference_asset_ids");
        if (value == null) {
            return;
        }
        if (!(value instanceof List<?> list) || list.isEmpty() || list.size() > 4
                || request.projectId() == null || request.userId() == null) {
            throw new InvalidRequestException();
        }
        for (Object item : list) {
            if (!(item instanceof Number number)) {
                throw new InvalidRequestException();
            }
            long assetId = number.longValue();
            if (assetId <= 0 || number.doubleValue() != (double) assetId) {
                throw new InvalidRequestException();
            }
        }
    }

    private GenerationProviderResult decodePng(String base64) throws IOException {
        int maxBytes = properties.getOpenai().getMaxImageBytes();
        if ((long) base64.length() * 3 / 4 > maxBytes) {
            return GenerationProviderResult.failure("invalid_provider_result", "图片生成结果超过大小限制");
        }
        byte[] content = Base64.getDecoder().decode(base64);
        if (content.length == 0 || content.length > maxBytes || !isPng(content)) {
            return GenerationProviderResult.failure("invalid_provider_result", "图片生成结果格式无效");
        }
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(content));
        if (image == null) {
            return GenerationProviderResult.failure("invalid_provider_result", "图片生成结果格式无效");
        }
        return GenerationProviderResult.success(content, "image/png", image.getWidth(), image.getHeight());
    }

    private boolean isPng(byte[] content) {
        byte[] signature = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
        if (content.length < signature.length) {
            return false;
        }
        for (int index = 0; index < signature.length; index++) {
            if (content[index] != signature[index]) {
                return false;
            }
        }
        return true;
    }

    private String imageSize(String aspectRatio) {
        String normalized = aspectRatio.toLowerCase(Locale.ROOT);
        if (LANDSCAPE_RATIOS.contains(normalized)) {
            return "1536x1024";
        }
        if (PORTRAIT_RATIOS.contains(normalized)) {
            return "1024x1536";
        }
        return "1024x1024";
    }

    private String trimTrailingSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private static class InvalidRequestException extends RuntimeException {
    }
}
