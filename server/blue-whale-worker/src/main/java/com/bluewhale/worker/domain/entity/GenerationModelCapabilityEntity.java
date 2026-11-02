package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("catalog_models")
public class GenerationModelCapabilityEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("model_id")
    private String modelId;

    @TableField("enabled")
    private Boolean enabled;

    @TableField("is_delete")
    private Boolean isDelete;

    @TableField("api_size")
    private String apiSize;

    @TableField("width")
    private Integer width;

    @TableField("height")
    private Integer height;

    @TableField("supported_sizes")
    private String supportedSizes;

    @TableField("features")
    private String features;

    @TableField("capability_type")
    private String capabilityType;

    @TableField("channel")
    private String channel;

    @TableField("request_mapping")
    private String requestMapping;

    @TableField("default_size")
    private String defaultSize;

    @TableField("default_aspect_ratio")
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
    public String getCapabilityType() { return capabilityType; }
    public void setCapabilityType(String capabilityType) { this.capabilityType = capabilityType; }
    public String getChannel() { return channel; }
    public void setChannel(String channel) { this.channel = channel; }
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
