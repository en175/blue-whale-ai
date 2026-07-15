package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.dto.ImageModelCapabilityDto;
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

    /** 查询指定能力类型下所有启用的模型能力。 */
    public List<ImageModelCapabilityDto> listCapabilities(String capabilityType) {
        List<GenerationModelCapability> capabilities = capabilityMapper.selectEnabledByCapabilityType(capabilityType);
        return capabilities.stream().map(this::toResponse).toList();
    }

    private ImageModelCapabilityDto toResponse(GenerationModelCapability cap) {
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
}
