package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.Conversation;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface ConversationMapper extends BaseMapper<Conversation> {

    @Select("SELECT * FROM conversations WHERE id = #{id} AND is_delete = 0 FOR UPDATE")
    Conversation selectForUpdate(Long id);

    /** 物理删除项目全部对话（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM conversations WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
