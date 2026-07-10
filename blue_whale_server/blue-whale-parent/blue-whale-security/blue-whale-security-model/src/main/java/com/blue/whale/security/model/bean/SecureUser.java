package com.blue.whale.security.model.bean;


import com.blue.whale.security.model.enums.UserStatus;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.util.Set;

/**
 * SecureUser
 *
 * @author: Jiyeon2__
 * date: 2025/3/25
 * description: 全局用户信息
 */
@Getter
@Setter
@Accessors(chain = true)
public class SecureUser implements Serializable {

    /**
     * 用户id 匿名用户id为空
     */
    private Long id;

    /**
     * 公司id
     */
    private Long companyId;

    /**
     * 用户名
     */
    private String username;

    /**
     * 密码
     */
    private String mobile;

    /**
     * 头像
     */
    private String avatar;

    /**
     * 用户状态
     */
    private UserStatus status;

    /**
     * 用户权限集合
     */
    private Set<String> perms = Set.of();

    /**
     * 可视部门集合
     */
    private Set<Long> departments = Set.of();

    /**
     * 所属部门id
     */
    private Long deptId;

    /**
     * 角色id
     */
    private Long roleId;

    /**
     * 角色值
     */
    private Integer roleValue;

    /**
     * 公司简称
     */
    private String shortForm;

    /**
     * 是否是匿名用户
     *
     * @return true 是 false 不是
     */
    public boolean isAnonymous() {
        return getId() == null;
    }
}
