package com.bluewhale.worker.domain.dto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 镜像 DTO 的字段对齐钉（IKGS73 / 0915 编译事故的防线，镜像 PublishImageEraseDtoParityTest）。
 *
 * <p>为什么需要这条：{@link PublishImageCutoutDto} 是照着 {@link PublishImageEraseDto}
 * 「镜像」写出来的，两个 record 字段完全同形。字段漂移在跨 PR 合并时**不是编译错误**
 * （两边是不同 Java 类型，各自自洽），直到某个调用点少了参数、整个批次编不过。
 *
 * <p>与 TS 契约（backend/libs/contracts/image-cutout.ts）的双端对账方向是 TS 读 Java：
 * image-cutout.test.ts 的「双端一致性」describe 块直接读本仓 ImageCutoutContract 源码
 * 文本逐值对账（Java 侧无法读 TS——docker mvn 只挂载 worker-java 目录），故本类只钉
 * Java 内部镜像 DTO 的形状，不再重复读文件。
 */
class PublishImageCutoutDtoParityTest {

    @Test
    @DisplayName("PublishImageCutoutDto 与 PublishImageEraseDto 的字段名与顺序逐项一致")
    void mirrorsEraseFieldNames() {
        assertThat(componentNames(PublishImageCutoutDto.class))
                .isEqualTo(componentNames(PublishImageEraseDto.class));
    }

    @Test
    @DisplayName("字段类型也逐项一致（同名字段类型漂移同样会炸调用点）")
    void mirrorsEraseFieldTypes() {
        assertThat(componentTypes(PublishImageCutoutDto.class))
                .isEqualTo(componentTypes(PublishImageEraseDto.class));
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
