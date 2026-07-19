package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.Canvas;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;

/**
 * 画布 Mapper：复用 MyBatis-Plus {@link BaseMapper}，被 {@code @MapperScan("com.blue.whale.agent.**.mapper")} 扫到。
 */
public interface CanvasMapper extends BaseMapper<Canvas> {

    /** 物理删除项目画布（生成收件箱永久删除的防御级联，收件箱正常无 canvas，绕过逻辑删除）。 */
    @Delete("DELETE FROM canvas WHERE project_id = #{projectId}")
    int hardDeleteByProjectId(@Param("projectId") Long projectId);
}
