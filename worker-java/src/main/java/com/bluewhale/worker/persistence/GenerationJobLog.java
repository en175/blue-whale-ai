package com.bluewhale.worker.persistence;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 生成作业日志行（对应 Prisma model generation_job_logs）。
 */
@TableName("generation_job_logs")
public class GenerationJobLog {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("generation_job_id")
    private Long generationJobId;

    @TableField("event")
    private String event;

    @TableField("status")
    private String status;

    @TableField("payload")
    private String payload; // JSON

    @TableField("message")
    private String message;

    @TableField("occurred_at")
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
