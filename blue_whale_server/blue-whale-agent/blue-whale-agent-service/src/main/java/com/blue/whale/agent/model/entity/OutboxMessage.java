package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Outbox 消息（ADR-0017 §1/§2）。
 *
 * <p>在产生产品事件的事务内同步写入，由 {@code OutboxPublisher} 重试发布稳定唤醒身份；
 * 产品事实仍保存在 project_events，通知重复不会创建新事实。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName(value = "outbox_messages", autoResultMap = true)
public class OutboxMessage extends BaseEntity {

    /** 待投递 */
    public static final String STATUS_PENDING = "pending";
    /** 已投递 */
    public static final String STATUS_PUBLISHED = "published";

    /** 消息稳定 ID（消费者按 (consumer, message_id) 去重） */
    private String messageId;

    private Long projectId;

    /** Project 内事件游标。cursor 为 MySQL 保留字，列名必须带反引号 */
    @TableField("`cursor`")
    private Long cursor;

    private String aggregateType;
    private String aggregateId;
    private String eventType;

    /** 消息 payload（与产品事件 payload 对齐） */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> payload;

    /** pending/published */
    private String status;

    /** 下次允许重试时间 */
    private LocalDateTime nextAttemptAt;

    /** 尝试次数 */
    private Integer attemptCount;
}
