package com.bluewhale.worker.domain.dto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 镜像 DTO 的字段对齐钉（IKGS73 / 0915 编译事故的防线）。
 *
 * <p>为什么需要这条：{@link PublishImageEraseDto} 是照着 {@link PublishImageEnhanceDto}
 * 「镜像」写出来的，两个 record 字段完全同形。2026-09-18 的一次交叉合并里，IKGS73 给 enhance
 * 那侧加了 {@code md5}，erase 这侧没跟上——**编译不会报错**（两边是不同 Java 类型，各自自洽），
 * 直到有人发现 {@code JobFinalizer.buildAsset} 的调用点少了参数、整个 0915 批次编不过。
 *
 * <p>字段漂移在跨 PR 合并时**不是编译错误**，所以只能靠一条断言把它变成机械可查的。
 * 将来给其中一个加字段而忘了另一个，这里会红。
 */
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
