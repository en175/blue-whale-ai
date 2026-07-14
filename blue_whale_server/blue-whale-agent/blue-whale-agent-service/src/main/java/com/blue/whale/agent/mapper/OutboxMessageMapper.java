package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.OutboxMessage;

/**
 * Outbox 消息 Mapper：复用 MyBatis-Plus {@link BaseMapper}，供同事务写入与后台重试发布器使用。
 */
public interface OutboxMessageMapper extends BaseMapper<OutboxMessage> {
}
