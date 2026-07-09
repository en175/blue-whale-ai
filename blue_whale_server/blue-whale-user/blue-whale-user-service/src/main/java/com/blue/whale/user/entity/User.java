package com.blue.whale.user.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.experimental.Accessors;

/**
 * 用户实体
 */
@Data
@EqualsAndHashCode(callSuper = true)
@Accessors(chain = true)
@TableName("users")
public class User extends BaseEntity {

    /** 手机号 */
    private String phone;

    /** 展示用户名 */
    private String username;

    /** 状态: NORMAL / EXPIRED / LOCKED / UNAVAILABLE */
    private String status;
}
