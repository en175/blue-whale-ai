package com.blue.whale.global.base.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

/**
 * BaseEntity
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
@Getter
@Setter
@EqualsAndHashCode(of = {"id"})
@Accessors(chain = true)
public class BaseEntity {

    /**
     * id
     */
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    /**
     * 创建时间
     */
    @TableField(value = "gmt_create", fill = FieldFill.INSERT)
    private LocalDateTime gmtCreate;
    /**
     * 更新时间
     */
    @TableField(value = "gmt_modified", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime gmtModified;
    /**
     * 乐观锁版本号
     */
    @Version
    @TableField(value = "version", fill = FieldFill.INSERT)
    private Integer version;
    /**
     * 逻辑删除标记
     */
    @TableLogic(value = "0", delval = "1")
    @TableField(value = "is_delete", fill = FieldFill.INSERT)
    private Boolean deleted;
}
