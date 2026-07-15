package com.blue.whale.agent.service.generation;

import com.volcengine.tos.TOSV2;
import com.volcengine.tos.comm.common.ACLType;
import com.volcengine.tos.model.object.GetObjectV2Input;
import com.volcengine.tos.model.object.GetObjectV2Output;
import com.volcengine.tos.model.object.PreSignedURLInput;
import com.volcengine.tos.model.object.PreSignedURLOutput;
import com.volcengine.tos.model.object.PutObjectInput;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TosGenerationStorageTest {

    private static final Instant NOW = Instant.parse("2026-07-15T04:00:00Z");

    private TOSV2 tosClient;
    private GenerationAdapterProperties properties;
    private TosGenerationStorage storage;

    @BeforeEach
    void setUp() {
        tosClient = mock(TOSV2.class);
        properties = new GenerationAdapterProperties();
        properties.getTos().setBucket("private-bucket");
        properties.getTos().setPrefix("generation-assets");
        properties.getTos().setSignedUrlTtlSeconds(120);
        properties.getTos().setMaxReadBytes(8);
        storage = new TosGenerationStorage(
                tosClient, properties, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void storesObjectsPrivatelyWithContentAddressedKey() throws Exception {
        byte[] content = "png-bytes".getBytes(StandardCharsets.UTF_8);
        String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));

        StoredGenerationObject stored = storage.store(content, "image/png");

        assertThat(stored.storageKey()).isEqualTo("generation-assets/sha256/" + digest + ".png");
        assertThat(stored.contentSha256()).isEqualTo(digest);
        assertThat(stored.mimeType()).isEqualTo("image/png");
        assertThat(stored.sizeBytes()).isEqualTo(content.length);
        ArgumentCaptor<PutObjectInput> inputCaptor = ArgumentCaptor.forClass(PutObjectInput.class);
        verify(tosClient).putObject(inputCaptor.capture());
        PutObjectInput input = inputCaptor.getValue();
        assertThat(input.getBucket()).isEqualTo("private-bucket");
        assertThat(input.getKey()).isEqualTo(stored.storageKey());
        assertThat(input.getContentLength()).isEqualTo(content.length);
        assertThat(input.getOptions().getContentType()).isEqualTo("image/png");
        assertThat(input.getOptions().getAclType()).isEqualTo(ACLType.ACL_PRIVATE);
        assertThat(input.getContent().readAllBytes()).isEqualTo(content);
    }

    @Test
    void signsShortLivedGetWithAbsoluteExpiry() {
        when(tosClient.preSignedURL(any(PreSignedURLInput.class)))
                .thenReturn(new PreSignedURLOutput("https://tos.example/signed", Map.of()));

        SignedGenerationObject signed = storage.sign("generation-assets/sha256/a.png");

        assertThat(signed.url()).isEqualTo("https://tos.example/signed");
        assertThat(signed.expiresAt()).isEqualTo(NOW.plusSeconds(120));
        ArgumentCaptor<PreSignedURLInput> inputCaptor = ArgumentCaptor.forClass(PreSignedURLInput.class);
        verify(tosClient).preSignedURL(inputCaptor.capture());
        assertThat(inputCaptor.getValue().getHttpMethod()).isEqualTo("GET");
        assertThat(inputCaptor.getValue().getBucket()).isEqualTo("private-bucket");
        assertThat(inputCaptor.getValue().getKey()).isEqualTo("generation-assets/sha256/a.png");
        assertThat(inputCaptor.getValue().getExpires()).isEqualTo(120);
    }

    @Test
    void readsObjectWithinConfiguredLimit() throws Exception {
        GetObjectV2Output output = mock(GetObjectV2Output.class);
        when(output.getContentLength()).thenReturn(8L);
        when(output.getContent()).thenReturn(new ByteArrayInputStream("12345678".getBytes(StandardCharsets.UTF_8)));
        when(tosClient.getObject(any(GetObjectV2Input.class))).thenReturn(output);

        assertThat(storage.read("generation-assets/sha256/a.png"))
                .isEqualTo("12345678".getBytes(StandardCharsets.UTF_8));
        verify(output).close();
    }

    @Test
    void rejectsObjectLargerThanConfiguredLimit() {
        GetObjectV2Output output = mock(GetObjectV2Output.class);
        when(output.getContentLength()).thenReturn(9L);
        when(tosClient.getObject(any(GetObjectV2Input.class))).thenReturn(output);

        assertThatThrownBy(() -> storage.read("generation-assets/sha256/a.png"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("TOS 对象超过读取上限");
    }
}
