package com.bluewhale.worker.domain.contract;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** IKIHPJ：跨进程常量行为钉死（client_token 派生 + 转存容量）。 */
class AudioVideoMuxContractTest {

    @Test
    @DisplayName("client_token 从 jobId+提交尝试序号确定性派生：同输入同 token、递增换 token、≤64 可打印 ASCII")
    void derivesClientTokenDeterministicallyWithinVendorLimits() {
        assertThat(AudioVideoMuxContract.clientToken("70", 1)).isEqualTo("bwmux-70-1");
        assertThat(AudioVideoMuxContract.clientToken("70", 1))
                .isEqualTo(AudioVideoMuxContract.clientToken("70", 1));
        assertThat(AudioVideoMuxContract.clientToken("70", 2))
                .isNotEqualTo(AudioVideoMuxContract.clientToken("70", 1));
        String worstCase = AudioVideoMuxContract.clientToken("9".repeat(20), 9_999);
        assertThat(worstCase.length()).isLessThanOrEqualTo(64);
        assertThat(worstCase).matches("[!-~]+");
    }

    @Test
    @DisplayName("成品转存上限对齐音频侧 10 GiB 先例（IKI696），不复用抠像 1 GiB 旧口径")
    void pinsTransferCapacityToTheTenGibAudioPrecedent() {
        assertThat(AudioVideoMuxContract.MAX_RESULT_BYTES).isEqualTo(10L << 30);
    }

    @Test
    @DisplayName("sync 三档与固定来源冻结值")
    void pinsSyncTiersAndSource() {
        assertThat(AudioVideoMuxContract.SYNC_VALUES).containsExactly("none", "video", "audio");
        assertThat(AudioVideoMuxContract.SOURCE).isEqualTo("dock");
        assertThat(AudioVideoMuxContract.TAG).isEqualTo("audio_video_mux");
    }
}
