package com.bluewhale.worker.domain.dto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class PublishImageEraseDtoParityTest {

    @Test
    @DisplayName("PublishImageEraseDto 与 PublishImageEnhanceDto 的字段名与顺序逐项一致")
    void mirrorsEnhanceFieldNames() {
        assertThat(componentNames(PublishImageEraseDto.class))
                .isEqualTo(componentNames(PublishImageEnhanceDto.class));
    }

    @Test
    @DisplayName("字段类型也逐项一致（同名字段类型漂移同样会炸调用点）")
    void mirrorsEnhanceFieldTypes() {
        assertThat(componentTypes(PublishImageEraseDto.class))
                .isEqualTo(componentTypes(PublishImageEnhanceDto.class));
    }

    private static List<String> componentNames(Class<? extends Record> type) {
        return Arrays.stream(type.getRecordComponents()).map(RecordComponent::getName).toList();
    }

    private static List<String> componentTypes(Class<? extends Record> type) {
        return Arrays.stream(type.getRecordComponents())
                .map(c -> c.getType().getSimpleName())
                .toList();
    }
}
