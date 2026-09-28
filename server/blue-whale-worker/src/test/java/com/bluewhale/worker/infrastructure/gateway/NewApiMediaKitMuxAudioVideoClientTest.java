package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** IKIHPJ：sync 单字段 → 出站键映射钉死（迁移契约 §21.3）。 */
class NewApiMediaKitMuxAudioVideoClientTest {

    @Test
    @DisplayName("sync=none：不传 is_video_audio_sync/sync_mode/sync_method")
    void noneSyncOmitsAllSyncFields() {
        Map<String, Object> payload = NewApiMediaKitMuxAudioVideoClient.submitPayload(
                "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-1");
        assertThat(payload).containsExactlyInAnyOrderEntriesOf(Map.of(
                "model", "mediakit-mux-audio-video",
                "video_url", "https://tos/v.mp4",
                "audio_url", "https://tos/a.mp3",
                "is_audio_reserve", true,
                "client_token", "bwmux-70-1"));
    }

    @Test
    @DisplayName("sync=video/audio：显式 is_video_audio_sync=true + sync_mode=<值> + sync_method=trim")
    void alignedSyncAlwaysSendsExplicitTrim() {
        for (String sync : new String[] {"video", "audio"}) {
            Map<String, Object> payload = NewApiMediaKitMuxAudioVideoClient.submitPayload(
                    "https://tos/v.mp4", "https://tos/a.mp3", false, sync, "bwmux-70-2");
            assertThat(payload).containsEntry("is_video_audio_sync", true);
            assertThat(payload).containsEntry("sync_mode", sync);
            assertThat(payload).containsEntry("sync_method", "trim");
            assertThat(payload).containsEntry("is_audio_reserve", false);
        }
    }

    @Test
    @DisplayName("不传 media_output_destination / callback_* / queue_id（默认队列、不回调）")
    void neverSendsDestinationCallbackOrQueue() {
        Map<String, Object> payload = NewApiMediaKitMuxAudioVideoClient.submitPayload(
                "https://tos/v.mp4", "https://tos/a.mp3", true, "video", "bwmux-70-3");
        assertThat(payload.keySet())
                .doesNotContain("media_output_destination", "callback_url", "callback_args", "queue_id");
    }

    @Test
    @DisplayName("出站键恒为供应商 snake_case，不与冻结快照 camel 命名混用")
    void outboundKeysStaySnakeCase() {
        Map<String, Object> payload = NewApiMediaKitMuxAudioVideoClient.submitPayload(
                "https://tos/v.mp4", "https://tos/a.mp3", true, "none", "bwmux-70-4");
        assertThat(payload.keySet()).doesNotContain("assetId", "nodeId", "audio", "video", "sync");
        assertThat(AudioVideoMuxContract.SYNC_VALUES).containsExactly("none", "video", "audio");
    }
}
