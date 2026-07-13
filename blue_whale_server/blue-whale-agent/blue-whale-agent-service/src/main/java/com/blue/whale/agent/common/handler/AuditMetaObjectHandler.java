package com.blue.whale.agent.common.handler;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * MyBatis-Plus 审计字段自动填充：插入填创建/更新时间、版本、逻辑删除；更新填更新时间。
 * 配合 {@code common.entity.BaseEntity} 的 {@code @TableField(fill = ...)}。注册为 Bean 由 MyBatis-Plus 自动采用。
 */
//@Component
public class AuditMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        LocalDateTime now = LocalDateTime.now();
        this.strictInsertFill(metaObject, "gmtCreate", LocalDateTime.class, now);
        this.strictInsertFill(metaObject, "gmtModified", LocalDateTime.class, now);
        this.strictInsertFill(metaObject, "version", Integer.class, 0);
        this.strictInsertFill(metaObject, "deleted", Boolean.class, false);
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        this.strictUpdateFill(metaObject, "gmtModified", LocalDateTime.class, LocalDateTime.now());
    }
}
