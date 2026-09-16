package com.bluewhale.worker.infrastructure.storage;

import com.volcengine.tos.TOSV2;
import com.volcengine.tos.model.object.GetObjectV2Output;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 下载心跳（IKFS5W）：读超时放宽到 5min 后，单次下载可能超过 120s 任务租约，
 * 下载过程中必须按心跳续租，否则任务会被判定过期、被另一个 worker 抢走重跑。
 */
class TosMediaStorageTest {

    /** 每个分块先 sleep 再吐数据，模拟慢速下载。 */
    private static final class SlowStream extends InputStream {
        private final int chunks;
        private final long gapMs;
        private int emitted;

        private SlowStream(int chunks, long gapMs) {
            this.chunks = chunks;
            this.gapMs = gapMs;
        }

        @Override
        public int read(byte[] b, int off, int len) {
            if (emitted >= chunks) {
                return -1;
            }
            emitted++;
            try {
                Thread.sleep(gapMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            b[off] = 1;
            return 1;
        }

        @Override
        public int read() {
            return -1;
        }
    }

    private static TosMediaStorage storageWith(InputStream content, long contentLength, TOSV2 client) {
        GetObjectV2Output output = mock(GetObjectV2Output.class);
        when(output.getContentLength()).thenReturn(contentLength);
        when(output.getContent()).thenReturn(content);
        when(client.getObject(any())).thenReturn(output);
        return new TosMediaStorage(client, "bucket", "endpoint");
    }

    @Test
    @DisplayName("慢速下载期间按间隔触发心跳，字节完整落盘")
    void heartbeatFiresDuringSlowDownload(@TempDir Path tempDir) throws IOException {
        Path output = tempDir.resolve("out.mp4");
        AtomicInteger beats = new AtomicInteger();
        TosMediaStorage storage = storageWith(new SlowStream(3, 8), 3, mock(TOSV2.class));

        storage.download("https://tos/v.mp4", "videos/v.mp4", output, 1024, beats::incrementAndGet, 10);

        assertThat(beats.get()).isGreaterThanOrEqualTo(1);
        assertThat(Files.size(output)).isEqualTo(3);
    }

    @Test
    @DisplayName("快下载不触发心跳（间隔未到）")
    void fastDownloadSkipsHeartbeat(@TempDir Path tempDir) throws IOException {
        Path output = tempDir.resolve("fast.mp4");
        AtomicInteger beats = new AtomicInteger();
        TosMediaStorage storage = storageWith(new SlowStream(2, 0), 2, mock(TOSV2.class));

        storage.download("https://tos/v.mp4", "videos/v.mp4", output, 1024, beats::incrementAndGet, 60_000);

        assertThat(beats.get()).isZero();
        assertThat(Files.size(output)).isEqualTo(2);
    }
}
