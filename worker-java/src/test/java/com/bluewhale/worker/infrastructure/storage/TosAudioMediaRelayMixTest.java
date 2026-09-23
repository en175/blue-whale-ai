package com.bluewhale.worker.infrastructure.storage;

import com.sun.net.httpserver.HttpServer;
import com.volcengine.tos.TOSV2;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.PutObjectACLInput;
import com.volcengine.tos.model.object.PutObjectInput;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;

class TosAudioMediaRelayMixTest {
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
