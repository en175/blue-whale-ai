package com.blue.whale.security.model.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * UserStatus
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description: 用户状态枚举
 */
@Getter
@RequiredArgsConstructor
public enum UserStatus {
    /**
     * 正常
     */
    NORMAL(0),
    /**
     * 已过期
     */
    EXPIRED(1),
    /**
     * 已锁定
     */
    LOCKED(2),
    /**
     * 凭证已过期
     */
    CREDENTIALS_EXPIRED(3),
    /**
     * 离职
     */
    UNAVAILABLE(4);

    @EnumValue
    private final Integer value;
}
