package com.blue.whale.global.enums;


import com.baomidou.mybatisplus.annotation.EnumValue;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * TaskStatus
 *
 * @author: Jiyeon2__
 * date: 2025/7/28
 * description:
 */
@Getter
@AllArgsConstructor
public enum TaskStatus {

    /**
     * 等待中
     */
    PENDING(0),
    /**
     * 成功
     */
    SUCCESS(1),
    /**
     * 失败
     */
    FAIL(2),
    ;

    @EnumValue
    private final Integer value;
}
