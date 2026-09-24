package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 生成模型能力行（对应 Prisma model generation_model_capability）。
 * <p>
 * 图片刀用：findImageCapability（asset-ops.ts:103-149）读取模型 ID、API 尺寸、
 * 宽高、参考图上限、渠道解析器与请求映射。
 * <p>
 * 字段名与 schema.prisma 完全一致（snake_case），MyBatis-Plus 自动驼峰转换。
 */
@TableName("generation_model_capability")
public class GenerationModelCapabilityEntity {
    @TableId(type = IdType.AUTO)
    /** 主键 */
    private Long id;

    @TableField("model_id")
    /** 模型标识（如 gpt-image-1、doubao-seedream-5-0-pro-260628） */
    private String modelId;

    @TableField("enabled")
    /** 是否启用（findImageCapability WHERE 条件，asset-ops.ts:105） */
    private Boolean enabled;

    @TableField("is_delete")
    /** 软删标记（findImageCapability WHERE 条件，asset-ops.ts:105） */
    private Boolean isDelete;

    @TableField("api_size")
    /** 默认 API 尺寸（能力行级别，当无 sizeId 匹配时回退） */
    private String apiSize;

    @TableField("width")
    /** 默认宽度 */
    private Integer width;

    @TableField("height")
    /** 默认高度 */
    private Integer height;

    @TableField("supported_sizes")
    /** 支持的尺寸列表 JSON（Array of {id, api_value/apiValue, width, height}） */
    private String supportedSizes; // JSON

    @TableField("features")
    /** 特性 JSON（含 imageReferenceMax / image_reference_max） */
    private String features; // JSON

    @TableField("channel_parser")
    /** 渠道解析器（seedream / gpt / banana；缺省 seedream，asset-ops.ts:143） */
    private String channelParser;

    @TableField("request_mapping")
    /** 请求映射 JSON（gpt: {matrix}; banana: {quality, size}） */
    private String requestMapping; // JSON

    @TableField("default_size")
    /** 默认尺寸 ID（gpt/banana 回退键） */
    private String defaultSize;

    @TableField("default_aspect_ratio")
    /** 默认宽高比 ID（gpt/banana 回退键） */
    private String defaultAspectRatio;

    @TableField("gmt_create")
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    private LocalDateTime gmtModified;

    @TableField("version")
    private Integer version;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getModelId() { return modelId; }
    public void setModelId(String modelId) { this.modelId = modelId; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
    public Boolean getIsDelete() { return isDelete; }
    public void setIsDelete(Boolean isDelete) { this.isDelete = isDelete; }
    public String getApiSize() { return apiSize; }
    public void setApiSize(String apiSize) { this.apiSize = apiSize; }
    public Integer getWidth() { return width; }
    public void setWidth(Integer width) { this.width = width; }
    public Integer getHeight() { return height; }
    public void setHeight(Integer height) { this.height = height; }
    public String getSupportedSizes() { return supportedSizes; }
    public void setSupportedSizes(String supportedSizes) { this.supportedSizes = supportedSizes; }
    public String getFeatures() { return features; }
    public void setFeatures(String features) { this.features = features; }
    public String getChannelParser() { return channelParser; }
    public void setChannelParser(String channelParser) { this.channelParser = channelParser; }
    public String getRequestMapping() { return requestMapping; }
    public void setRequestMapping(String requestMapping) { this.requestMapping = requestMapping; }
    public String getDefaultSize() { return defaultSize; }
    public void setDefaultSize(String defaultSize) { this.defaultSize = defaultSize; }
    public String getDefaultAspectRatio() { return defaultAspectRatio; }
    public void setDefaultAspectRatio(String defaultAspectRatio) { this.defaultAspectRatio = defaultAspectRatio; }
    public LocalDateTime getGmtCreate() { return gmtCreate; }
    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }
    public LocalDateTime getGmtModified() { return gmtModified; }
    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
}
