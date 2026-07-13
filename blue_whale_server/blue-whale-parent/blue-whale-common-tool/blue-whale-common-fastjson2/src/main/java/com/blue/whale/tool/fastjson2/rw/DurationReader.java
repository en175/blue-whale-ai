package com.blue.whale.tool.fastjson2.rw;


import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.modules.ObjectReaderModule;
import com.alibaba.fastjson2.reader.ObjectReader;
import com.alibaba.fastjson2.reader.ObjectReaderProvider;

import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.function.Function;

/**
 * DurationReader
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: duration reader 毫秒 格式
 */
public class DurationReader implements ObjectReader<Duration>, ObjectReaderModule, Function<Object, Duration> {

    @Override
    public Duration readObject(JSONReader jsonReader, Type fieldType, Object fieldName, long features) {
        if (jsonReader.isNull()) {
            return null;
        }
        String durationStr = jsonReader.readString();
        if (StrUtil.isBlank(durationStr)) {
            return null;
        }
        return this.apply(durationStr);
    }

    @Override
    public Duration apply(Object value) {
        if (value instanceof Double doubleMills) {
            return Duration.ofMillis(doubleMills.longValue());
        }
        if (value instanceof BigDecimal decimalMills) {
            return Duration.ofMillis(decimalMills.longValue());
        }
        return Duration.ofMillis(Double.valueOf(String.valueOf(value)).longValue());
    }

    @Override
    public void init(ObjectReaderProvider provider) {
        provider.registerTypeConvert(BigDecimal.class, Duration.class, this);
        provider.registerTypeConvert(Integer.class, Duration.class, this);
        provider.registerTypeConvert(Double.class, Duration.class, this);
        provider.registerTypeConvert(Float.class, Duration.class, this);
        provider.registerTypeConvert(Long.class, Duration.class, this);
        provider.registerTypeConvert(String.class, Duration.class, this);
    }
}
