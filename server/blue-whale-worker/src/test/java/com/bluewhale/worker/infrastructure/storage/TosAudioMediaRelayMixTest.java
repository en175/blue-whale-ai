package com.bluewhale.worker.infrastructure.storage;

import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.PutObjectACLInput;
import com.volcengine.tos.model.object.PutObjectInput;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;

import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class TosAudioMediaRelayMixTest {
    @Test
    void storesAResultLargerThanTheFormerOneGiBLimitWithoutBufferingIt() throws Exception {
        Assumptions.assumeTrue("1".equals(System.getenv("IKI696_LARGE_TRANSFER")));
        long totalBytes = (1L << 30) + 1;
        byte[] chunk = new byte[64 * 1024];
        java.util.Arrays.fill(chunk, (byte) 11);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/large.wav", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "audio/wav");
            exchange.sendResponseHeaders(200, totalBytes);
            try (var output = exchange.getResponseBody()) {
                long remaining = totalBytes;
                while (remaining > 0) {
                    int size = (int) Math.min(remaining, chunk.length);
                    output.write(chunk, 0, size);
                    remaining -= size;
                }
            }
        });
        server.start();
        try {
            TOSV2 client = mock(TOSV2.class);
            doAnswer(invocation -> {
                PutObjectInput upload = invocation.getArgument(0);
                assertThat(upload.getContent()).isNotInstanceOf(ByteArrayInputStream.class);
                assertThat(upload.getContentLength()).isEqualTo(totalBytes);
                long read = 0;
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = upload.getContent().read(buffer)) != -1) read += count;
                assertThat(read).isEqualTo(totalBytes);
                return null;
            }).when(client).putObject(any(PutObjectInput.class));
            var result = new TosAudioMediaRelay(client, "our-bucket", "tos.example")
                    .persist("http://127.0.0.1:" + server.getAddress().getPort() + "/large.wav", "9", "wav");
            assertThat(result.size()).isEqualTo(totalBytes);
            assertThat(result.mime()).isEqualTo("audio/wav");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void streamsAudioThroughAFileInsteadOfKeepingTheResultInHeap() throws Exception {
        byte[] chunk = new byte[64 * 1024];
        java.util.Arrays.fill(chunk, (byte) 7);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/large.flac", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "audio/flac");
            exchange.sendResponseHeaders(200, (long) chunk.length * 128);
            try (var output = exchange.getResponseBody()) {
                for (int i = 0; i < 128; i++) output.write(chunk);
            }
        });
        server.start();
        try {
            TOSV2 client = mock(TOSV2.class);
            doAnswer(invocation -> {
                PutObjectInput upload = invocation.getArgument(0);
                assertThat(upload.getContent()).isNotInstanceOf(ByteArrayInputStream.class);
                assertThat(upload.getContentLength()).isEqualTo((long) chunk.length * 128);
                assertThat(upload.getContent().readAllBytes()).hasSize(chunk.length * 128);
                return null;
            }).when(client).putObject(any(PutObjectInput.class));
            var result = new TosAudioMediaRelay(client, "our-bucket", "tos.example")
                    .persist("http://127.0.0.1:" + server.getAddress().getPort() + "/large.flac", "9", "flac");
            assertThat(result.size()).isEqualTo((long) chunk.length * 128);
            assertThat(result.mime()).isEqualTo("audio/flac");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void oversizedAudioIsRejectedMidStreamBeforeTouchingStorage() throws Exception {
        byte[] chunk = new byte[64 * 1024];
        java.util.Arrays.fill(chunk, (byte) 9);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/flood.wav", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "audio/wav");
            exchange.sendResponseHeaders(200, 64L * 1024 * 1024);
            try (var output = exchange.getResponseBody()) {
                while (true) output.write(chunk);
            } catch (java.io.IOException ignored) {
            }
        });
        server.start();
        try {
            TOSV2 client = mock(TOSV2.class);
            var relay = new TosAudioMediaRelay(client, "our-bucket", "tos.example", 1024);
            assertThatThrownBy(() -> relay.persist("http://127.0.0.1:" + server.getAddress().getPort()
                    + "/flood.wav", "9", "wav"))
                    .isInstanceOf(com.bluewhale.worker.domain.error.MediaExtractError.class)
                    .hasMessageContaining("转存上限");
            verifyNoInteractions(client);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void expiredTemporaryAudioCannotCreateAnAsset() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/expired", exchange -> {
            exchange.sendResponseHeaders(403, -1);
            exchange.close();
        });
        server.start();
        try {
            TOSV2 client = mock(TOSV2.class);
            var relay = new TosAudioMediaRelay(client, "our-bucket", "tos.example");
            assertThatThrownBy(() -> relay.persist("http://127.0.0.1:" + server.getAddress().getPort()
                    + "/expired", "9", "mp3"))
                    .hasMessageContaining("HTTP 403");
            verifyNoInteractions(client);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void downloadsProviderAudioThenUploadsExactBytesAndMakesTheObjectPublic() throws Exception {
        byte[] audio = "ID3-provider-mix".getBytes(StandardCharsets.UTF_8);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/temporary.mp3", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "audio/mpeg");
            exchange.sendResponseHeaders(200, audio.length);
            try (var output = exchange.getResponseBody()) { output.write(audio); }
        });
        server.start();
        try {
            TOSV2 client = mock(TOSV2.class);
            var uploaded = new AtomicReference<byte[]>();
            doAnswer(invocation -> {
                PutObjectInput input = invocation.getArgument(0);
                uploaded.set(input.getContent().readAllBytes());
                assertThat(input.getBucket()).isEqualTo("our-bucket");
                assertThat(input.getKey()).startsWith("generated/9/audio/").endsWith(".mp3");
                return null;
            }).when(client).putObject(any(PutObjectInput.class));
            var relay = new TosAudioMediaRelay(client, "our-bucket", "tos.example");
            var result = relay.persist("http://127.0.0.1:" + server.getAddress().getPort()
                    + "/temporary.mp3", "9", "mp3");

            assertThat(uploaded.get()).isEqualTo(audio);
            assertThat(result.url()).isEqualTo("https://our-bucket.tos.example/" + result.storageKey());
            assertThat(result.mime()).isEqualTo("audio/mpeg");
            assertThat(result.size()).isEqualTo((long) audio.length);
            assertThat(result.md5()).isEqualTo(ContentDigest.md5Hex(audio));
            var calls = inOrder(client);
            calls.verify(client).putObject(any(PutObjectInput.class));
            calls.verify(client).putObjectAcl(org.mockito.ArgumentMatchers.argThat((PutObjectACLInput input) ->
                    input.getBucket().equals("our-bucket")
                    && input.getKey().equals(result.storageKey())
                    && input.getAcl() == ACLType.ACL_PUBLIC_READ));
        } finally {
            server.stop(0);
        }
    }
}
