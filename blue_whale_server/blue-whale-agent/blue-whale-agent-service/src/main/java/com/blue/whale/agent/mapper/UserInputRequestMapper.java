package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.UserInputRequest;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;

public interface UserInputRequestMapper extends BaseMapper<UserInputRequest> {

    @Select("SELECT * FROM user_input_requests WHERE id = #{id} AND is_delete = 0 FOR UPDATE")
    UserInputRequest selectForUpdate(@Param("id") Long id);

    @Select("SELECT * FROM user_input_requests WHERE project_id = #{projectId} "
            + "AND user_id = #{userId} AND request_target_type = #{requestTargetType} "
            + "AND action_identity = #{actionIdentity} AND is_delete = 0 LIMIT 1 FOR UPDATE")
    UserInputRequest selectStandaloneForUpdate(
            @Param("projectId") Long projectId,
            @Param("userId") Long userId,
            @Param("requestTargetType") String requestTargetType,
            @Param("actionIdentity") String actionIdentity);

    @Select("SELECT CURRENT_TIMESTAMP")
    LocalDateTime selectCurrentTime();

    /** 物理删除项目全部输入请求（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM user_input_requests WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
