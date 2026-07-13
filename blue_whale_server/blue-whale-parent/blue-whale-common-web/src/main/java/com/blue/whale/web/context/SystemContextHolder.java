package com.blue.whale.web.context;


import com.alibaba.ttl.TransmittableThreadLocal;
import com.blue.whale.web.model.Systems;

/**
 * SystemContextHolder
 *
 * @author: Jiyeon2__
 * date: 2025/4/1
 * description: 客户端ip地址上下文
 */
public class SystemContextHolder {

    private static final ThreadLocal<Systems> LOCAL = new TransmittableThreadLocal<>();

    public static void set(Systems systems){
        LOCAL.set(systems);
    }

    public static Systems get() {
        return LOCAL.get();
    }


    public static void clear(){
        LOCAL.remove();
    }
}
