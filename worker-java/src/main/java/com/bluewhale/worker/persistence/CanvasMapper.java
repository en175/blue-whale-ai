package com.bluewhale.worker.persistence;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * 画布 Mapper（media-extract-canvas-ops.ts：withCanvasUpdate 版本守卫 CAS）。
 * <p>
 * SQL 逐字移植自 TS Prisma canvas.findFirst + canvas.updateMany。
 */
@Mapper
public interface CanvasMapper extends BaseMapper<Canvas> {

    /**
     * 查找项目画布（media-extract-canvas-ops.ts:40-43）。
     * <p>
     * WHERE project_id = ? AND is_delete = 0
     */
    @Select("""
            SELECT id, project_id, nodes_json, version, is_delete
            FROM canvas
            WHERE project_id = #{projectId}
              AND is_delete = 0
            LIMIT 1
            """)
    Canvas findByProjectId(@Param("projectId") Long projectId);

    /**
     * CAS 更新画布 nodes_json（media-extract-canvas-ops.ts:47-50）。
     * <p>
     * SET nodes_json = ?, version = version + 1
     * WHERE id = ? AND version = ?
     * <p>
     * 返回受影响行数（0 = 版本冲突，需重试）。
     */
    @Update("""
            UPDATE canvas
            SET nodes_json = #{nodesJson},
                version = version + 1
            WHERE id = #{id}
              AND version = #{version}
            """)
    int updateNodesCas(
            @Param("id") Long id,
            @Param("version") Integer version,
            @Param("nodesJson") String nodesJson
    );
}
