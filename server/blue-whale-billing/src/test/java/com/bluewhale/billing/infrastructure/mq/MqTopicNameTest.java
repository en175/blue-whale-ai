package com.bluewhale.billing.infrastructure.mq;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * MQ topic 名的**合法性守卫**。
 *
 * <h2>为什么值得单独一个测试</h2>
 *
 * RocketMQ 对 topic 名有字符集限制（{@code ^[%|a-zA-Z0-9_-]+$}）。名字里带一个点号，
 * 编译器不会说、单元测试不会红、`/ready` 也不会——**只有进程真去连 broker 的那一刻**
 * 才会以 {@code BadRequestException: The specified topic[...] contains illegal characters}
 * 失败，而那时消费者 bean 造不出来，**整个服务起不来**。
 *
 * <p>这不是假想：契约里这两个 topic 原本叫 {@code generation.job.completed} /
 * {@code generation.job.failed}（点号分隔的业务事件命名，读起来很自然），
 * 2026-09-25 本地起服务时当场炸出来。同一仓的生成队列早已是
 * {@code generation-task}（连字符），这两个是唯一的例外。
 *
 * <p>⚠️ 刻意**不起 Spring 上下文**：起上下文要 DB + MQ，而这个断言只关于两个字符串——
 * 为了读两个默认值去连 broker，等于让「名字写错了」这个检查本身也变得起不来。
 * 所以直接读 `application.yml`，测的就是部署时真正生效的那份默认值。
 */
class MqTopicNameTest {

    /** RocketMQ 5 允许的 topic 名：字母数字 + 下划线 + 连字符（外加 `%` `|`，本仓不用）。 */
    private static final Pattern ALLOWED = Pattern.compile("^[%|a-zA-Z0-9_-]+$");

    private static final String YAML = readApplicationYaml();

    private static String readApplicationYaml() {
        try (InputStream in = MqTopicNameTest.class.getResourceAsStream("/application.yml")) {
            assertThat(in).withFailMessage("读不到 application.yml").isNotNull();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("读 application.yml 失败", e);
        }
    }

    /** 取 `key: ${ENV:默认值}` 里的默认值（冒号后面的那截）。 */
    private static String defaultValueOf(String key) {
        Matcher m = Pattern.compile("^\\s*" + Pattern.quote(key) + ":\\s*\\$\\{[^:}]+:([^}]*)}",
                Pattern.MULTILINE).matcher(YAML);
        assertThat(m.find())
                .withFailMessage("application.yml 里找不到 %s 的默认值形式 `${ENV:default}`", key)
                .isTrue();
        return m.group(1).trim();
    }

    @Test
    @DisplayName("★ 两个 topic 的默认值都只含合法字符 —— 含点号会让整个服务起不来")
    void 默认topic名合法() {
        assertThat(defaultValueOf("topic-completed"))
                .withFailMessage("topic 名含非法字符（RocketMQ 只收 [%%|a-zA-Z0-9_-]）：点号是最容易踩的")
                .matches(ALLOWED);
        assertThat(defaultValueOf("topic-failed")).matches(ALLOWED);
    }

    @Test
    @DisplayName("★ 两个 topic 必须不同 —— 同名的结果是「失败的也走结算」")
    void 两个topic不同名() {
        assertThat(defaultValueOf("topic-completed")).isNotEqualTo(defaultValueOf("topic-failed"));
    }
}
