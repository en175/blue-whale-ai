package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.AssistantMessageStream;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Select;

public interface AssistantMessageStreamMapper extends BaseMapper<AssistantMessageStream> {
    @Select("SELECT * FROM assistant_message_streams WHERE stream_id = #{streamId} AND is_delete = 0 FOR UPDATE")
    AssistantMessageStream selectByStreamIdForUpdate(@Param("streamId") String streamId);

    @Delete("DELETE FROM assistant_message_streams WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
