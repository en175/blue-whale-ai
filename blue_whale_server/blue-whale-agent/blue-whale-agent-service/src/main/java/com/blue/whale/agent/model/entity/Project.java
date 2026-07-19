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

    /** 项目用途：canvas 画布项目 */
    public static final String PURPOSE_CANVAS = "canvas";
    /** 项目用途：generation_inbox 生成收件箱（每用户最多一个活动实例，从项目列表隐藏） */
    public static final String PURPOSE_GENERATION_INBOX = "generation_inbox";

    /** 归属用户 ID */
    private Long ownerId;

    /** 项目名 */
    private String name;

    /** 缩略图 url */
    private String thumb;

    /** 项目用途（canvas / generation_inbox）；inbox_guard 为 DB 生成列，不映射 */
    private String purpose;
}
