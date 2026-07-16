package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.dto.ImageModelCapabilityDto;
import com.blue.whale.agent.model.dto.VideoModelCapabilityDto;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 模型能力查询服务：为前端提供按能力类型发现可用模型的能力。
 */
@Service
@RequiredArgsConstructor
public class GenerationModelCapabilityService {

    private final GenerationModelCapabilityMapper capabilityMapper;

    /** 查询启用的图片生成模型能力。 */
    public List<ImageModelCapabilityDto> listImageCapabilities() {
        return capabilityMapper.selectEnabledByCapabilityType(GenerationModelCapability.CAPABILITY_IMAGE)
                .stream().map(this::toImageResponse).toList();
    }

    /** 查询启用的视频生成模型能力。 */
    public List<VideoModelCapabilityDto> listVideoCapabilities() {
        return capabilityMapper.selectEnabledByCapabilityType(GenerationModelCapability.CAPABILITY_VIDEO)
                .stream().map(this::toVideoResponse).toList();
    }

    private ImageModelCapabilityDto toImageResponse(GenerationModelCapability cap) {
        List<ImageModelCapabilityDto.SizeOption> sizes = cap.getSupportedSizes() == null
                ? List.of()
                : cap.getSupportedSizes().stream()
                .map(o -> new ImageModelCapabilityDto.SizeOption(
                        o.getId(), o.getLabel(), o.getApiValue(), o.getWidth(), o.getHeight()))
                .toList();

        GenerationModelCapability.Features src = cap.getFeatures();
        ImageModelCapabilityDto.Features features = src == null
                ? new ImageModelCapabilityDto.Features(false, false, 1, false, false, false)
                : new ImageModelCapabilityDto.Features(
                Boolean.TRUE.equals(src.getReferenceImage()),
                Boolean.TRUE.equals(src.getWatermark()),
                src.getQuantityMax(),
                Boolean.TRUE.equals(src.getSequentialImageGeneration()),
                Boolean.TRUE.equals(src.getStream()),
                Boolean.TRUE.equals(src.getTools()));

        return new ImageModelCapabilityDto(
                cap.getModelId(),
                cap.getProviderId(),
                cap.getModelLabel(),
                cap.getIcon(),
                sizes,
                cap.getSupportedAspectRatios() == null ? List.of() : cap.getSupportedAspectRatios(),
                cap.getSupportedFormats() == null ? List.of() : cap.getSupportedFormats(),
                cap.getDefaultSize(),
                cap.getDefaultFormat(),
                cap.getDefaultAspectRatio(),
                features
        );
    }

    /** entity → video DTO：分辨率复用 supportedSizes，时长取 supportedDurations，特性取 video 子集。 */
    private VideoModelCapabilityDto toVideoResponse(GenerationModelCapability cap) {
        List<VideoModelCapabilityDto.ResolutionOption> resolutions = cap.getSupportedSizes() == null
                ? List.of()
                : cap.getSupportedSizes().stream()
                .map(o -> new VideoModelCapabilityDto.ResolutionOption(o.getId(), o.getLabel(), o.getApiValue()))
                .toList();

        GenerationModelCapability.DurationRange dr = cap.getSupportedDurations();
        VideoModelCapabilityDto.DurationRange durationRange = dr == null
                ? null
                : new VideoModelCapabilityDto.DurationRange(dr.getMin(), dr.getMax(), dr.getStep());

        GenerationModelCapability.Features src = cap.getFeatures();
        VideoModelCapabilityDto.VideoFeatures features = src == null
                ? new VideoModelCapabilityDto.VideoFeatures(false, false, false, false, false, false)
                : new VideoModelCapabilityDto.VideoFeatures(
                Boolean.TRUE.equals(src.getFirstFrame()),
                Boolean.TRUE.equals(src.getFirstLastFrame()),
                Boolean.TRUE.equals(src.getReferenceImage()),
                Boolean.TRUE.equals(src.getWatermark()),
                Boolean.TRUE.equals(src.getAudio()),
                Boolean.TRUE.equals(src.getTools()));

        return new VideoModelCapabilityDto(
                cap.getModelId(),
                cap.getProviderId(),
                cap.getModelLabel(),
                cap.getIcon(),
                resolutions,
                cap.getSupportedAspectRatios() == null ? List.of() : cap.getSupportedAspectRatios(),
                durationRange,
                cap.getDefaultSize(),
                cap.getDefaultAspectRatio(),
                cap.getDefaultDuration(),
                features
        );
    }
}
