package com.bluewhale.worker.infrastructure.config;

import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.infrastructure.persistence.mapper.SystemSettingMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Base64;
import java.util.HexFormat;

import static com.bluewhale.worker.infrastructure.config.SystemSettingEnvelopeVectors.BLANK_KEY_ENVELOPE;
import static com.bluewhale.worker.infrastructure.config.SystemSettingEnvelopeVectors.ENVELOPE;
import static com.bluewhale.worker.infrastructure.config.SystemSettingEnvelopeVectors.FAKE_KEY;
import static com.bluewhale.worker.infrastructure.config.SystemSettingEnvelopeVectors.FAKE_SECRET_HEX;
import static com.bluewhale.worker.infrastructure.config.SystemSettingEnvelopeVectors.PLAINTEXT;
import static com.bluewhale.worker.infrastructure.config.SystemSettingEnvelopeVectors.ROTATED_ENVELOPE;
import static com.bluewhale.worker.infrastructure.config.SystemSettingEnvelopeVectors.ROTATED_KEY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SystemSettingEnvelopeTest {

    private static SystemSettingMapper mapperReturning(String rowValue) {
        return key -> rowValue;
    }

    private static final class FakeRow implements SystemSettingMapper {
        private String value;

        FakeRow(String value) {
            this.value = value;
        }

        @Override
        public String selectValue(String key) {
            return value;
        }
    }


    @Test
    @DisplayName("★ 解 TS 侧封的信封：格式对齐，跨语言不漂")
    void opensNodeSealedEnvelope() {
        assertThat(SystemSettingEnvelope.open(ENVELOPE, FAKE_SECRET_HEX)).isEqualTo(PLAINTEXT);
    }

    @Test
    @DisplayName("主密钥另一种写法：base64（32 字节）与十六进制等价")
    void opensWithBase64Secret() {
        String secretBase64 = Base64.getEncoder().encodeToString(HexFormat.of().parseHex(FAKE_SECRET_HEX));
        assertThat(SystemSettingEnvelope.open(ENVELOPE, secretBase64)).isEqualTo(PLAINTEXT);
    }

    @Test
    @DisplayName("密文被改过 → 抛，不返回垃圾：GCM 的认证标签就是干这个的")
    void tamperedCiphertextIsRejected() {
        String tampered = ENVELOPE.substring(0, ENVELOPE.length() - 2) + "AA";
        assertThatThrownBy(() -> SystemSettingEnvelope.open(tampered, FAKE_SECRET_HEX))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("解密失败");
    }

    @Test
    @DisplayName("密钥换了 → 抛（同一句话：运维要查的是 SYSTEM_SETTINGS_SECRET 有没有变）")
    void wrongSecretIsRejected() {
        String otherSecret = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
        assertThatThrownBy(() -> SystemSettingEnvelope.open(ENVELOPE, otherSecret))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("解密失败");
    }

    @Test
    @DisplayName("★ 明文或旧格式一律拒：那说明有人绕过服务写过库，静默当成明文用会把那件事盖住")
    void plaintextAndOldFormatsAreRejected() {
        assertThatThrownBy(() -> SystemSettingEnvelope.open(PLAINTEXT, FAKE_SECRET_HEX))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("信封格式不对");
        assertThatThrownBy(() -> SystemSettingEnvelope.open("v2.a.b.c", FAKE_SECRET_HEX))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("信封格式不对");
        assertThatThrownBy(() -> SystemSettingEnvelope.open("", FAKE_SECRET_HEX))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("主密钥缺失 / 长度不对 → 抛（不降级成明文，也不 KDF 一个弱密钥出来）")
    void badMasterSecretIsRejected() {
        assertThatThrownBy(() -> SystemSettingEnvelope.masterKey(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(SystemSettingEnvelope.SECRET_ENV);
        assertThatThrownBy(() -> SystemSettingEnvelope.masterKey("  "))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> SystemSettingEnvelope.masterKey("00112233"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("须为 32 字节");
    }


    @Test
    @DisplayName("★ 配了 → 取到 key（走完整链路：行 → 解封 → 取字段）")
    void requireKeyReadsConfiguredKey() {
        UpstreamCredential credential =
                new UpstreamCredential(mapperReturning(ENVELOPE), FAKE_SECRET_HEX);
        assertThat(credential.requireKey()).isEqualTo(FAKE_KEY);
    }

    @Test
    @DisplayName("★ 没配 → 明确拒绝，**不是空串**：空串打上游只会收一个来路不明的 401")
    void requireKeyFailsClosedWhenUnset() {
        UpstreamCredential missing = new UpstreamCredential(mapperReturning(null), FAKE_SECRET_HEX);
        assertThatThrownBy(missing::requireKey)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("未配置");

        UpstreamCredential blankRow = new UpstreamCredential(mapperReturning("   "), FAKE_SECRET_HEX);
        assertThatThrownBy(blankRow::requireKey)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("未配置");
    }

    @Test
    @DisplayName("行在但字段空 → 同样拒（配了半份等于没配）")
    void requireKeyFailsClosedWhenFieldBlank() {
        UpstreamCredential credential =
                new UpstreamCredential(mapperReturning(BLANK_KEY_ENVELOPE), FAKE_SECRET_HEX);
        assertThatThrownBy(credential::requireKey)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("为空");
    }

    @Test
    @DisplayName("密钥不对 → 抛，不退化成「没配」（不然运维会去查管理端，而问题在部署）")
    void requireKeySurfacesDecryptFailure() {
        UpstreamCredential credential = new UpstreamCredential(
                mapperReturning(ENVELOPE),
                "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100");
        assertThatThrownBy(credential::requireKey)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("解密失败");
    }

    @Test
    @DisplayName("★ 改配置 → 下一次调用就取到新值（读点不缓存，管理端改完即生效）")
    void requireKeySeesRotatedValueOnNextCall() {
        FakeRow row = new FakeRow(ENVELOPE);
        UpstreamCredential credential = new UpstreamCredential(row, FAKE_SECRET_HEX);

        assertThat(credential.requireKey()).isEqualTo(FAKE_KEY);
        row.value = ROTATED_ENVELOPE;
        assertThat(credential.requireKey()).isEqualTo(ROTATED_KEY);
    }
}
