package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.ConversationMessage;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface ConversationMessageMapper extends BaseMapper<ConversationMessage> {

    /** 批量取每个对话的首条 user 消息（生成收件箱列表预览用，避免 N+1）。 */
    @Select("<script>"
            + "SELECT m.* FROM conversation_messages m JOIN ("
            + "SELECT conversation_id, MIN(sequence_no) AS min_seq FROM conversation_messages "
            + "WHERE conversation_id IN "
            + "<foreach collection='conversationIds' item='id' open='(' separator=',' close=')'>#{id}</foreach>"
            + " AND role = 'user' AND is_delete = 0 GROUP BY conversation_id"
            + ") first_msg ON m.conversation_id = first_msg.conversation_id "
            + "AND m.sequence_no = first_msg.min_seq WHERE m.is_delete = 0</script>")
    List<ConversationMessage> selectFirstUserMessages(@Param("conversationIds") List<Long> conversationIds);

    /** 物理删除项目全部消息（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM conversation_messages WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
