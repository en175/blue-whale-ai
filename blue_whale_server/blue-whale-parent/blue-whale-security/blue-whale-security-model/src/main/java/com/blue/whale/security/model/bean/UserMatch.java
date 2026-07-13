package com.blue.whale.security.model.bean;


import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.io.Serializable;

/**
 * UserMatch
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
@Getter
@Setter
@Builder
public class UserMatch implements Serializable {

    /**
     * 是否权限匹配成功
     */
    private boolean success;

    /**
     * 当前用户信息
     */
    private SecureUser secureUser;
}
