package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 生成作业日志行（对应 Prisma model generation_job_logs）。
 */
@TableName("generation_job_logs")
public class GenerationJobLogEntity {
    @TableId(type = IdType.AUTO)
    /** 主键（BigInt，对外字符串化承载） */
    private Long id;

    @TableField("generation_job_id")
    /** 产出该资产的任务 id；上传件为 null */
    private Long generationJobId;

    @TableField("event")
    /** 事件名（succeeded/failed/retry_scheduled/cancel_requested） */
    private String event;

    @TableField("status")
    /** 状态（jobs 六枚举见契约 §2；assets：normal/uploading） */
    private String status;

    @TableField("payload")
    /** 事件负载 JSON */
    private String payload; // JSON

    @TableField("message")
    /** 人类可读信息（失败为 code: message） */
    private String message;

    @TableField("occurred_at")
    /** 发生时间 */
    private LocalDateTime occurredAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getGenerationJobId() { return generationJobId; }
    public void setGenerationJobId(Long generationJobId) { this.generationJobId = generationJobId; }
    public String getEvent() { return event; }
    public void setEvent(String event) { this.event = event; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getPayload() { return payload; }
    public void setPayload(String payload) { this.payload = payload; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public LocalDateTime getOccurredAt() { return occurredAt; }
    public void setOccurredAt(LocalDateTime occurredAt) { this.occurredAt = occurredAt; }
}
