package com.blue.whale.tool.fastjson2.model;


import cn.hutool.core.map.WeakConcurrentMap;
import com.alibaba.fastjson2.JSONB;
import com.alibaba.fastjson2.util.Fnv;
import com.alibaba.fastjson2.util.TypeUtils;

import java.util.Map;

/**
 * TypeNameHash
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
public record TypeNameHash(long typeNameHash, byte[] typeNameJSONB) {
    public static Map<Class<?>, TypeNameHash> TYPE_NAME_MAP = new WeakConcurrentMap<>();

    public static TypeNameHash get(Class<?> clazz) {
        return TYPE_NAME_MAP.computeIfAbsent(
                clazz,
                cls -> {
                    String typeName = TypeUtils.getTypeName(cls);
                    return new TypeNameHash(Fnv.hashCode64(typeName), JSONB.toBytes(typeName));
                }
        );
    }
}