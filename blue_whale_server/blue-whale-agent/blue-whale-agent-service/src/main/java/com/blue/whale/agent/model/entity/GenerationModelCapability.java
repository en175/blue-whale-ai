package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.util.List;

/**
 * 模型能力注册表：记录每个 provider + model 的生成能力参数。
 *
 * <p>JSON 字段用 {@link JacksonTypeHandler} 整存整取；变更能力数据时同步更新本表，
 * 后端/前端均按能力表工作，避免在代码中硬编码模型差异。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName(value = "generation_model_capability", autoResultMap = true)
public class GenerationModelCapability extends BaseEntity {

    public static final String CAPABILITY_IMAGE = "image";
    public static final String CAPABILITY_VIDEO = "video";

    /** provider 标识，如 {@code volcengine} */
    private String providerId;

    /** 模型 ID，如 {@code doubao-seedream-5-0-lite-250723} */
    private String modelId;

    /** 能力类型：{@code image} / {@code video} */
    private String capabilityType;

    /** 前端展示名 */
    private String modelLabel;

    /** 模型图标 URL */
    private String icon;

    /** 支持的尺寸选项：id、label、api_value、width、height */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<SizeOption> supportedSizes;

    /** 支持的宽高比列表，如 {@code ["1:1","16:9"]} */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> supportedAspectRatios;

    /** 支持的输出格式；空数组表示不支持自定义格式 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> supportedFormats;

    /** 默认选中的 size_id */
    private String defaultSize;

    /** 默认输出格式 */
    private String defaultFormat;

    /** 默认宽高比 */
    private String defaultAspectRatio;

    /** 特性开关：参考图、水印、数量上限、组图、流式、工具等 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Features features;

    /** 是否启用 */
    private Boolean enabled;

    /** 尺寸选项 JSON 结构 */
    @Getter
    @Setter
    public static class SizeOption {
        private String id;
        private String label;
        private String apiValue;
        private Integer width;
        private Integer height;
    }

    /** 特性开关 JSON 结构 */
    @Getter
    @Setter
    public static class Features {
        private Boolean referenceImage;
        private Integer maxReferenceImages;
        private Boolean watermark;
        private Integer quantityMax;
        private Boolean sequentialImageGeneration;
        private Boolean stream;
        private Boolean tools;
    }

    /**
     * 按 size_id 查尺寸选项（大小写不敏感）；命中返回该选项，否则 null。
     * BottomDock 服务端校验与 Provider 路由共用，避免白名单解析逻辑双份。
     */
    public SizeOption findSizeById(String sizeId) {
        if (supportedSizes == null || supportedSizes.isEmpty() || sizeId == null || sizeId.isBlank()) {
            return null;
        }
        for (SizeOption option : supportedSizes) {
            if (option.getId() != null && option.getId().equalsIgnoreCase(sizeId)) {
                return option;
            }
        }
        return null;
    }
}
