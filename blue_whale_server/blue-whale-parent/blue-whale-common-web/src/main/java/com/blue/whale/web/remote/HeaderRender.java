package com.blue.whale.web.remote;

import cn.hutool.core.util.StrUtil;
import com.blue.whale.web.constant.SystemHeaders;
import com.blue.whale.web.model.ISystem;
import com.blue.whale.web.model.Systems;
import io.vavr.control.Option;

import java.util.HashMap;
import java.util.Map;

/**
 * HeaderRender
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
public class HeaderRender {
    private HeaderRender() {
    }

    public static Map<String, String> requestHeaders() {
        Option<Systems> systemsOpt = ISystem.systemOpt();
        Map<String, String> headers = new HashMap<>(16);
        if (systemsOpt.isEmpty()) {
            return headers;
        }
        Systems systems = systemsOpt.get();
        /*
         * ip地址
         */
        String ip = systems.getIp();
        if (StrUtil.isNotBlank(ip)) {
            headers.put(SystemHeaders.IP, ip);
        }
        /*
         * 设备id
         */
        String deviceId = systems.getDeviceId();
        if (StrUtil.isNotBlank(deviceId)) {
            headers.put(SystemHeaders.DEVICE_ID, deviceId);
        }

        return headers;
    }
}