package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.Conversation;
import org.apache.ibatis.annotations.Select;

public interface ConversationMapper extends BaseMapper<Conversation> {

    @Select("SELECT * FROM conversations WHERE id = #{id} AND is_delete = 0 FOR UPDATE")
    Conversation selectForUpdate(Long id);
}
