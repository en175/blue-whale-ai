package com.blue.whale.agent.service.generation;

import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.jupiter.api.Test;

import java.net.InetAddress;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class SeedanceVideoResultIngestorTest {

    @Test
    void rejectsAllowedHostWhenDnsResolvesToPrivateAddress() throws Exception {
        OkHttpClient client = new OkHttpClient.Builder()
                .dns(hostname -> List.of(InetAddress.getByName("127.0.0.1")))
                .build();
        SeedanceVideoResultIngestor ingestor = new SeedanceVideoResultIngestor(
                client, mock(VideoGenerationStorage.class), properties());

        assertThatThrownBy(() -> ingestor.ingest(
                1L, 0, "https://result.volces.com/video.mp4", 4, 4))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Seedance 视频下载失败");
    }

    @Test
    void refusesRedirectsBeforeFollowingLocation() {
        OkHttpClient client = new OkHttpClient.Builder()
                .addInterceptor(chain -> new Response.Builder()
                        .request(chain.request())
                        .protocol(Protocol.HTTP_1_1)
                        .code(302)
                        .message("Found")
                        .header("Location", "http://169.254.169.254/latest/meta-data")
                        .body(ResponseBody.create("", null))
                        .build())
                .build();
        SeedanceVideoResultIngestor ingestor = new SeedanceVideoResultIngestor(
                client, mock(VideoGenerationStorage.class), properties());

        assertThatThrownBy(() -> ingestor.ingest(
                1L, 0, "https://result.volces.com/video.mp4", 4, 4))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Seedance 视频下载失败");
    }

    private GenerationAdapterProperties properties() {
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.getSeedance().setAllowedResultHostSuffixes(List.of("volces.com"));
        return properties;
    }
}
