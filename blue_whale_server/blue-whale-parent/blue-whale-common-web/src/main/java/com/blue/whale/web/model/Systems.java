package com.blue.whale.web.model;


import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * Systems
 *
 * @author: Jiyeon2__
 * date: 2025/4/1
 * description:
 */
@Getter
@Setter
@Accessors(chain = true)
public class Systems {

    /**
     * 公司id
     */
    private Long companyId;
    /**
     * 客户端ip地址
     */
    private String ip;
    /**
     * 客户端设备id
     */
    private String deviceId;

}
