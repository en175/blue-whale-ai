package com.blue.whale.security.resource.utils;


import com.alibaba.fastjson2.JSON;
import org.springframework.http.MediaType;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * ResponseUtil
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 响应处理 工具类
 */
public class ResponseUtil {

    /**
     * 响应数据
     *
     * @param response 响应
     * @throws IOException IO 异常
     */
    public static void response(HttpServletResponse response, Object value) throws IOException {
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().println(JSON.toJSONString(value));
        response.setStatus(HttpServletResponse.SC_OK);
        response.flushBuffer();
    }
}
