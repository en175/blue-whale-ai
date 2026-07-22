package com.blue.whale.gateway.util;

import org.springframework.http.HttpHeaders;

/**
 * 网关 Header 工具——清除客户端伪造头后设置网关信任值。
 * 所有通过 mutate().header() 下发敏感头的 Filter 统一走此方法，防追加不清除导致注入。
 */
public final class GatewayHeaderUtils {

    private GatewayHeaderUtils() {}

    /** 先 remove 再 add，避免客户端伪造头与网关下发值并存 */
    public static void sanitizeAndSet(HttpHeaders headers, String key, String value) {
        headers.remove(key);
        headers.add(key, value);
    }
}
