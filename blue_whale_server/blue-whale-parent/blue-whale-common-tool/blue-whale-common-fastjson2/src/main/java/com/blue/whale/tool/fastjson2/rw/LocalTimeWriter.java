package com.blue.whale.tool.fastjson2.rw;


import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.codec.DateTimeCodec;
import com.alibaba.fastjson2.writer.ObjectWriter;

import java.lang.reflect.Type;
import java.time.LocalTime;

/**
 * LocalTimeWriter
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: LocalTime 序列化
 */
public class LocalTimeWriter extends DateTimeCodec implements ObjectWriter<LocalTime> {
    public LocalTimeWriter(String format) {
        super(format, null);
    }

    @Override
    public void writeJSONB(JSONWriter jsonWriter, Object object, Object fieldName, Type fieldType, long features) {
        jsonWriter.writeLocalTime((LocalTime) object);
    }

    @Override
    public void write(JSONWriter jsonWriter, Object object, Object fieldName, Type fieldType, long features) {
        if (object == null) {
            jsonWriter.writeNull();
            return;
        }
        jsonWriter.writeString(getDateFormatter().format((LocalTime) object));
    }
}