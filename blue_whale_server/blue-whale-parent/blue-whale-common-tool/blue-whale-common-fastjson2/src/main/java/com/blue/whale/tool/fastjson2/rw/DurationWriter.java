package com.blue.whale.tool.fastjson2.rw;


import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.writer.ObjectWriter;
import com.blue.whale.tool.fastjson2.model.TypeNameHash;

import java.lang.reflect.Type;
import java.time.Duration;

/**
 * DurationWriter
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 *   duration writer 前端可以使用 moment js 处理和读取数据
 *   毫秒 格式
 */
public class DurationWriter implements ObjectWriter<Duration> {

    @Override
    public void writeJSONB(JSONWriter jsonWriter, Object object, Object fieldName, Type fieldType, long features) {
        if (object == null) {
            jsonWriter.writeNull();
            return;
        }
        if (!(object instanceof Duration duration)) {
            throw new IllegalArgumentException("DurationWriter-> DurationWriter not support type: " + object.getClass().getName());
        }
        if (jsonWriter.isWriteTypeInfo(object, fieldType, features)) {
            TypeNameHash typeNameHash = TypeNameHash.get(Duration.class);
            jsonWriter.writeTypeName(typeNameHash.typeNameJSONB(), typeNameHash.typeNameHash());
        }
        jsonWriter.writeString(String.valueOf(duration.toMillis()));
    }

    @Override
    public void write(JSONWriter jsonWriter, Object object, Object fieldName, Type fieldType, long features) {
        if (object == null) {
            jsonWriter.writeNull();
            return;
        }
        if (!(object instanceof Duration duration)) {
            throw new IllegalArgumentException("DurationWriter-> DurationWriter not support type: " + object.getClass().getName());
        }
        jsonWriter.writeString(String.valueOf(duration.toMillis()));
    }
}
