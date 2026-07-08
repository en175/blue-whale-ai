package com.blue.whale.user.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

/**
 * 图形验证码
 */
@Data
@Accessors(chain = true)
@TableName("captcha_challenges")
public class CaptchaChallenge {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 令牌 */
    private String token;

    /** 答案 */
    private String answer;

    /** 过期时间 */
    private LocalDateTime gmtExpire;

    /** 是否已验证 */
    private Boolean isVerified;

    /** 创建时间 */
    private LocalDateTime gmtCreate;
}
