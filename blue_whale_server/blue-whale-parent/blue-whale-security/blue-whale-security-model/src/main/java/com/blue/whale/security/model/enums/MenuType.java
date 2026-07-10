package com.blue.whale.security.model.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * MenuType
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description: 菜单类型
 */
@Getter
@RequiredArgsConstructor
public enum MenuType {

    /**
     * 目录
     */
    CATALOG(0),
    /**
     * 一级菜单
     */
    FIRST_LEVEL_MENU(1),
    /**
     * 二级菜单
     */
    SECOND_LEVEL_MENU(2),
    /**
     * 接口
     */
    API(3);

    @EnumValue
    private final Integer value;
}
