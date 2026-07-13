package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 画布状态实体：与 project 1:1（ADR-0011 D4）。
 * 整体存 {@code nodes_json} + {@code viewport_json}，后端当不透明 JSON 透传，不解析节点结构
 * （节点由前端 React Flow 定义，{@code data.assetId} 引用 asset，见 ADR-0011 D3）。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("canvas")
public class Canvas extends BaseEntity {

    /** 所属项目 ID（唯一） */
    private Long projectId;

    /** 视口 JSON 字符串：{@code {x, y, zoom}} */
    private String viewportJson;

    /** 节点数组 JSON 字符串：{@code [{id, type, position, data:{assetId, ...}}]} */
    private String nodesJson;
}
