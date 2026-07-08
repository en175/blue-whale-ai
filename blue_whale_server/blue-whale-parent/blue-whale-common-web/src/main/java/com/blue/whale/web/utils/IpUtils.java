package com.blue.whale.web.utils;

import cn.hutool.core.text.StrPool;
import com.blue.whale.web.constant.SystemHeaders;
import org.springframework.util.StringUtils;

import javax.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Optional;

/**
 * IpUtils
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
public class IpUtils {

    private static final String LOCAL_HOST_IP_V4 = "127.0.0.1";
    private static final String LOCAL_HOST_IP_V6 = "0:0:0:0:0:0:0:1";
    private static final String UNKNOWN = "unknown";

    private static final String[] POSSIBLE_IP_HEADERS = {
            SystemHeaders.IP,
            "x-forwarded-for",
            "X-Forwarded-For",
            "Proxy-Client-IP",
            "WL-Proxy-Client-IP",
            "HTTP_CLIENT_IP",
            "HTTP_X_FORWARDED_FOR"
    };

    /**
     * 获取客户端IP
     *
     * @param request 请求对象
     * @return IP地址
     */
    public static String getIpAddr(HttpServletRequest request) {
        if (request == null) {
            return UNKNOWN;
        }
        String ip = null;

        for (String possibleIpHeader : POSSIBLE_IP_HEADERS) {
            ip = request.getHeader(possibleIpHeader);
            if (!isUnknown(ip)) {
                break;
            }
        }
        if (isUnknown(ip)) {
            ip = Optional.ofNullable(request.getRemoteAddr()).orElse("");
            if (LOCAL_HOST_IP_V4.equals(ip) || LOCAL_HOST_IP_V6.equals(ip)) {
                // 根据网卡取本机配置的IP
                try {
                    InetAddress inet = InetAddress.getLocalHost();
                    ip = inet.getHostAddress();
                } catch (UnknownHostException ignore) {
                }
            }
        }

        return LOCAL_HOST_IP_V6.equals(ip) ? LOCAL_HOST_IP_V4 : getMultistageReverseProxyIp(ip);
    }

    /**
     * 从多级反向代理中获得第一个非unknown IP地址
     *
     * @param ip 获得的IP地址
     * @return 第一个非unknown IP地址
     */
    public static String getMultistageReverseProxyIp(String ip) {
        // 多级反向代理检测
        if (ip != null && ip.indexOf(StrPool.COMMA) > 0) {
            final String[] ips = ip.trim().split(StrPool.COMMA);
            for (String subIp : ips) {
                if (!isUnknown(subIp)) {
                    ip = subIp;
                    break;
                }
            }
        }
        return ip;
    }

    /**
     * 检测给定字符串是否为未知，多用于检测HTTP请求相关
     *
     * @param checkString 被检测的字符串
     * @return 是否未知
     */
    public static boolean isUnknown(String checkString) {
        return !StringUtils.hasText(checkString) || UNKNOWN.equalsIgnoreCase(checkString);
    }
}