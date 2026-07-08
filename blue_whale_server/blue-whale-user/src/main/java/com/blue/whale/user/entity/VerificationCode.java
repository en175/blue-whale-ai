package com.blue.whale.user.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

/**
 * 短信验证码
 */
@Data
@Accessors(chain = true)
@TableName("verification_codes")
public class VerificationCode {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 手机号 */
    private String phone;

    /** 6位验证码 */
    private String code;

    /** 请求IP */
    private String ip;

    /** 过期时间 */
    private LocalDateTime gmtExpire;

    /** 是否已使用 */
    private Boolean isUsed;

    /** 创建时间 */
    private LocalDateTime gmtCreate;
}
