package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * Project 事件流高水位记录（ADR-0017 §3）。
 *
 * <p>每个 Project 一行，持有当前已分配的最大 {@code cursor}。产生产品事件的事务通过
 * {@code SELECT ... FOR UPDATE} 锁定该行，分配连续游标区间并在同一事务更新高水位；
 * 事务回滚则游标分配一并回滚。Snapshot 读取此高水位作为 {@code high_watermark_cursor}，
 * 保证客户端从该游标接续 SSE 时不会漏掉并发事件。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("project_event_stream")
public class ProjectEventStream {

    /** 所属项目 ID（主键，与 project.id 对齐） */
    @TableId
    private Long projectId;

    /** 当前高水位游标（已分配的最大 cursor，初始 0） */
    private Long highWatermark;
}
