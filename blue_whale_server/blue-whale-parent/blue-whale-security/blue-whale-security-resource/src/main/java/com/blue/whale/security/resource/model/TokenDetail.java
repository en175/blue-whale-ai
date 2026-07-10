package com.blue.whale.security.resource.model;


import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import lombok.experimental.Accessors;

import java.io.Serializable;

/**
 * TokenDetail
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
@Getter
@Setter
@Accessors(chain = true)
@ToString
public class TokenDetail implements Serializable {
    /**
     * token类型
     */
    private String type;
    /**
     * token
     */
    private String value;
}
