package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * 画布项目实体：workspace 唯一根（ADR-0011）。归属用户（{@code ownerId} 来自 {@code X-User-Id} 头）。
 * canvas / asset / job 全部挂 project 下。
 */
@Getter
@Setter
@Accessors(chain = true)
@TableName("project")
public class Project extends BaseEntity {

    /** 归属用户 ID */
    private Long ownerId;

    /** 项目名 */
    private String name;

    /** 缩略图 url */
    private String thumb;
}
