package com.blue.whale.tool.fastjson2.filter;


import cn.hutool.core.annotation.AnnotationUtil;
import cn.hutool.core.util.DesensitizedUtil;
import cn.hutool.core.util.ReUtil;
import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.filter.ValueFilter;
import com.blue.whale.tool.fastjson2.annotation.Desensitize;
import lombok.SneakyThrows;

import java.lang.reflect.Field;
import java.util.Map;

/**
 * DesensitizeWriteFilter
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 脱敏写入过滤器write filter
 */
public class DesensitizeWriteFilter implements ValueFilter {

    @SneakyThrows
    @Override
    public Object apply(Object object, String name, Object value) {
        if (object instanceof Map || !(value instanceof CharSequence charSequence)) {
            return value;
        }
        int length = charSequence.length();
        if (length == 0) {
            return value;
        }
        Field field;
        try {
            field = object.getClass().getDeclaredField(name);
        } catch (NoSuchFieldException ignored) {
            return value;
        }
        Desensitize annotation = AnnotationUtil.getAnnotation(field, Desensitize.class);
        if (annotation == null) {
            return value;
        }
        //如果设置了开始和结束位置
        int start, end;
        if ((start = annotation.start()) != -1 && (end = annotation.end()) != -1) {
            return StrUtil.hide(charSequence, start, length - end);
        }
        //如果设置了正则表达式和模板
        String regx, template;
        if (StrUtil.isNotEmpty(regx = annotation.regx()) && StrUtil.isNotEmpty(template = annotation.template())) {
            return ReUtil.replaceAll(charSequence, regx, template);
        }
        //否则使用 脱敏工具脱敏
        return DesensitizedUtil.desensitized(charSequence, annotation.type());

    }
}