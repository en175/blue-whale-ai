package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.OutboxMessage;

/**
 * Outbox 消息 Mapper：复用 MyBatis-Plus {@link BaseMapper}。首版只写入，投递/Reconciler 后续工单。
 */
public interface OutboxMessageMapper extends BaseMapper<OutboxMessage> {
}
