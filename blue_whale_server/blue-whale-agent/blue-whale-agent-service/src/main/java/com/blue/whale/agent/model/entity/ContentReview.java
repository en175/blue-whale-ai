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
 * ContentReview 规范化决定事实（ADR-0029）：只持久化决定、内容摘要、模态、策略版本、
 * 原因码与最小化证据引用，不持久化供应商完整响应或原始媒体。
 *
 * <p>逻辑唯一身份 = project_id + subject_type + subject_id + content_digest
 * + modality + direction + policy_version；只能从 pending 进入终态
 * decided / failed，只有 decided + pass 允许内容继续，其余组合 fail closed。
 * 例外：agent_text 的 failed 不是终态——审核暂时不可用不形成永久决定，
 * 恢复后按同一身份重审并更新同一行（见 ContentReviewService#reviewAgentText）。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName(value = "content_reviews", autoResultMap = true)
public class ContentReview extends BaseEntity {

    /** 受审主体：生成输出槽位 */
    public static final String SUBJECT_TYPE_GENERATION_OUTPUT = "generation_output";
    public static final String SUBJECT_TYPE_AGENT_TEXT = "agent_text";

    /** 模态 */
    public static final String MODALITY_IMAGE = "image";
    public static final String MODALITY_TEXT = "text";

    /** 方向：面向 User 的输出 */
    public static final String DIRECTION_OUTPUT = "output";

    /** 审核状态：pending | decided | failed */
    public static final String STATE_PENDING = "pending";
    public static final String STATE_DECIDED = "decided";
    public static final String STATE_FAILED = "failed";

    /** 决定（仅 decided 携带）：pass | reject；failed 的决定必须为空 */
    public static final String DECISION_PASS = "pass";
    public static final String DECISION_REJECT = "reject";

    private Long projectId;
    private Long userId;

    /** 受审主体类型（如 generation_output） */
    private String subjectType;

    /** 受审主体标识（如 generation-job:{jobId}:slot:{n}） */
    private String subjectId;

    /** 内容摘要（SHA-256 hex） */
    private String contentDigest;

    /** 模态（image / video） */
    private String modality;

    /** 方向（input / output） */
    private String direction;

    /** 审核策略版本 */
    private String policyVersion;

    /** pending / decided / failed */
    private String reviewState;

    /** pass / reject；仅 decided 非空 */
    private String decision;

    /** timeout / unavailable / rate_limited / invalid_evidence / invalid_request / authentication_failed / authorization_failed */
    private String failureCode;

    /** 产品规范化安全原因码（仅 reject；JSON 整存整取，不检索） */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> reasonCodes;

    /** 最小化证据引用 */
    private String evidenceRef;
}
