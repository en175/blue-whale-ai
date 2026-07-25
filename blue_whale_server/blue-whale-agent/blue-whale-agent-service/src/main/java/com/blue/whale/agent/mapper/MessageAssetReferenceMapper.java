package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.MessageAssetReference;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;

/**
 * 消息 @ 引用关系 Mapper（@MapperScan 已在 AgentApplication 覆盖 com.blue.whale.agent.**.mapper）。
 */
public interface MessageAssetReferenceMapper extends BaseMapper<MessageAssetReference> {

    /** 物理删除项目全部 @ 引用关系（项目永久删除用，与 conversation_messages 同生命周期）。 */
    @Delete("DELETE FROM message_asset_reference WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
