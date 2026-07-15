package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 生成任务实体：文生图 / 图文生视频任务的持久化。
 *
 * <p>状态机 {@code queued → processing → succeeded | failed}，视频任务另支持
 * {@code processing → cancel_requested → cancelled}。
 * JSON 字段（input / outputAssetIds / error）用 {@link JacksonTypeHandler} 整存整取，不检索。
 * 热查询列（status / nextActionAt / leaseExpiresAt）为一等列，配索引供 Worker 扫描。
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
    public static final String STATUS_CANCEL_REQUESTED = "cancel_requested";
    public static final String STATUS_CANCELLED = "cancelled";

    /** 来源 */
    public static final String SOURCE_DOCK = "dock";
    public static final String SOURCE_BOTTOM_DOCK = "bottom_dock";
    public static final String SOURCE_AGENT = "agent";
    public static final String SOURCE_AGENT_RUN = "agent_run";

    private Long projectId;
    private Long userId;
    private Long agentRunId;
    private String actionIdentity;

    /** image / video */
    private String type;
    /** dock / bottom_dock / agent / agent_run */
    private String source;

    /** 生成输入参数（prompt/model/resolution 等），整存整取 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> input;

    /** queued / processing / cancel_requested / succeeded / failed / cancelled */
    private String status;

    /** 进度 0-100 */
    private Integer progress;

    /** Java Generation Worker 的短租约执行权。 */
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private String leaseOwner;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private LocalDateTime leaseExpiresAt;
    private Long fencingToken;

    /** 创建时固化的执行策略与绝对期限。 */
    private String strategyVersion;
    private LocalDateTime executionDeadlineAt;
    private LocalDateTime evidenceReconcileUntil;
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private LocalDateTime nextActionAt;
    private LocalDateTime cancelRequestedAt;

    /** 输出 asset id 列表 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Long> outputAssetIds;

    /** 旧视频闭环遗留列；新 Provider 证据写入 generation_provider_tasks。 */
    private String provider;

    /** 旧视频闭环遗留列；不再写入。 */
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
