package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.AssistantMessageChunk;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;

public interface AssistantMessageChunkMapper extends BaseMapper<AssistantMessageChunk> {
    @Delete("DELETE FROM assistant_message_chunks WHERE assistant_message_stream_id IN "
            + "(SELECT id FROM assistant_message_streams WHERE project_id = #{projectId})")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
