package com.bluewhale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.bluewhale.agent.common.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 生成任务实体：文生图 / 图文生视频任务的持久化。
 *
 * <p>状态机 {@code queued → processing → succeeded | failed}（沿用 PRD §5.4）。
 * JSON 字段（input / outputAssetIds / error）用 {@link JacksonTypeHandler} 整存整取，不检索。
 * 热查询列（status / nextPollAt / providerTaskId）为一等列，配索引供 poller 扫描。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName(value = "generation_jobs", autoResultMap = true)
public class GenerationJob extends BaseEntity {

    /** 任务类型：image / video */
    public static final String TYPE_IMAGE = "image";
    public static final String TYPE_VIDEO = "video";

    /** 任务状态 */
    public static final String STATUS_QUEUED = "queued";
    public static final String STATUS_PROCESSING = "processing";
    public static final String STATUS_SUCCEEDED = "succeeded";
    public static final String STATUS_FAILED = "failed";

    /** 来源 */
    public static final String SOURCE_DOCK = "dock";
    public static final String SOURCE_AGENT = "agent";

    private Long projectId;
    private Long userId;

    /** image / video */
    private String type;
    /** dock / agent */
    private String source;

    /** 生成输入参数（prompt/model/resolution 等），整存整取 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> input;

    /** queued / processing / succeeded / failed */
    private String status;

    /** 进度 0-100 */
    private Integer progress;

    /** 输出 asset id 列表 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Long> outputAssetIds;

    /** volcengine */
    private String provider;

    /** 火山任务 id */
    private String providerTaskId;

    private Integer pollCount;
    private LocalDateTime nextPollAt;
    private Integer retryCount;
    private LocalDateTime lastPolledAt;

    /** 错误信息 JSON：{code, message} */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> error;

    /** 画布 stage id */
    private String stageId;
}
