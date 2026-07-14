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
 * Outbox 消息（ADR-0017 §1/§2 最小骨架）。
 *
 * <p>首版只在产生产品事件的事务内同步写入，不实现投递/Reconciler（后续工单接入 MQ 或轮询）。
 * 其作用是建立与产品状态同事务的待投递记录骨架，保证后续投递器上线时可直接消费，
 * 而无需再改写事件写入路径。{@code status} 首版恒为 {@code pending}。
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

    private String aggregateType;
    private String aggregateId;
    private String eventType;

    /** 消息 payload（与产品事件 payload 对齐） */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> payload;

    /** pending/published */
    private String status;

    /** 下次尝试时间（骨架，Reconciler 后续工单使用） */
    private LocalDateTime nextAttemptAt;

    /** 尝试次数 */
    private Integer attemptCount;
}
