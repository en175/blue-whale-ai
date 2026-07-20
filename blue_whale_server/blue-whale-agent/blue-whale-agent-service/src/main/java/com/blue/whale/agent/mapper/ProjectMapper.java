package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.Project;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 项目 Mapper：复用 MyBatis-Plus {@link BaseMapper}，被 {@code @MapperScan("com.blue.whale.agent.**.mapper")} 扫到。
 */
public interface ProjectMapper extends BaseMapper<Project> {

    @Select("SELECT * FROM project WHERE id = #{projectId} AND is_delete = 0 FOR UPDATE")
    Project selectForUpdate(@Param("projectId") Long projectId);

    /** 物理删除项目行（生成收件箱永久删除用，绕过逻辑删除）。 */
    @Delete("DELETE FROM project WHERE id = #{projectId}")
    int hardDeleteById(@Param("projectId") Long projectId);
}
