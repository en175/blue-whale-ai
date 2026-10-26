package com.bluewhale.worker.domain.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("generation_outbox")
public class GenerationOutboxEntity {

    public static final String STATE_PENDING = "pending";

    public static final String STATE_SENT = "sent";

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("job_id")
    private Long jobId;

    @TableField("user_id")
    private Long userId;

    @TableField("terminal_status")
    private String terminalStatus;

    @TableField("reason")
    private String reason;

    @TableField("send_state")
    private String sendState;

    @TableField("attempts")
    private Integer attempts;

    @TableField("gmt_create")
    private LocalDateTime gmtCreate;

    @TableField("gmt_modified")
    private LocalDateTime gmtModified;

    @TableField("sent_at")
    private LocalDateTime sentAt;

    public Long getId() { return id; }

    public void setId(Long id) { this.id = id; }

    public Long getJobId() { return jobId; }

    public void setJobId(Long jobId) { this.jobId = jobId; }

    public Long getUserId() { return userId; }

    public void setUserId(Long userId) { this.userId = userId; }

    public String getTerminalStatus() { return terminalStatus; }

    public void setTerminalStatus(String terminalStatus) { this.terminalStatus = terminalStatus; }

    public String getReason() { return reason; }

    public void setReason(String reason) { this.reason = reason; }

    public String getSendState() { return sendState; }

    public void setSendState(String sendState) { this.sendState = sendState; }

    public Integer getAttempts() { return attempts; }

    public void setAttempts(Integer attempts) { this.attempts = attempts; }

    public LocalDateTime getGmtCreate() { return gmtCreate; }

    public void setGmtCreate(LocalDateTime gmtCreate) { this.gmtCreate = gmtCreate; }

    public LocalDateTime getGmtModified() { return gmtModified; }

    public void setGmtModified(LocalDateTime gmtModified) { this.gmtModified = gmtModified; }

    public LocalDateTime getSentAt() { return sentAt; }

    public void setSentAt(LocalDateTime sentAt) { this.sentAt = sentAt; }
}
