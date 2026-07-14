package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.ProjectEventStream;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Project 事件流高水位 Mapper（ADR-0017 §3）。
 *
 * <p>{@link #selectForUpdate} 在产生产品事件的事务内锁定该 Project 的高水位行，分配连续游标；
 * 事务回滚则游标分配一并回滚。MySQL InnoDB 行锁，H2（MODE=MySQL）同样支持。
 */
public interface ProjectEventStreamMapper extends BaseMapper<ProjectEventStream> {

    /**
     * 锁定并读取该 Project 的高水位行（必须在事务内调用）。
     *
     * @param projectId 项目 ID
     * @return 高水位记录，不存在返回 null（调用方负责初始化）
     */
    @Select("SELECT project_id, high_watermark FROM project_event_stream WHERE project_id = #{projectId} FOR UPDATE")
    ProjectEventStream selectForUpdate(@Param("projectId") Long projectId);
}
