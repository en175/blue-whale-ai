package com.blue.whale.agent.service.generation;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Dns;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

import java.io.IOException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.Locale;

public class SeedanceVideoResultIngestor implements VideoResultIngestor {

    private final OkHttpClient httpClient;
    private final VideoGenerationStorage storage;
    private final GenerationAdapterProperties properties;

    public SeedanceVideoResultIngestor(
            OkHttpClient httpClient,
            VideoGenerationStorage storage,
            GenerationAdapterProperties properties) {
        Dns upstreamDns = httpClient.dns();
        this.httpClient = httpClient.newBuilder()
                .followRedirects(false)
                .followSslRedirects(false)
                .dns(hostname -> publicAddresses(upstreamDns, hostname))
                .build();
        this.storage = storage;
        this.properties = properties;
    }

    @Override
    public VideoIngestedResult ingest(
            Long jobId,
            String temporaryResultUrl,
            Integer providerDurationSeconds,
            int expectedDurationSeconds) {
        HttpUrl url = temporaryResultUrl == null ? null : HttpUrl.parse(temporaryResultUrl);
        if (url == null || !"https".equals(url.scheme())
                || !url.username().isEmpty() || !url.password().isEmpty()
                || !isAllowedHost(url.host())) {
            throw new IllegalArgumentException("Seedance 临时结果地址无效");
        }
        if (providerDurationSeconds == null || providerDurationSeconds != expectedDurationSeconds) {
            throw new IllegalArgumentException("Seedance 视频时长与请求不一致");
        }
        Request request = new Request.Builder().url(url).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            ResponseBody body = response.body();
            if (!response.isSuccessful() || body == null) {
                throw new IllegalStateException("Seedance 视频下载失败");
            }
            MediaType type = body.contentType();
            long length = body.contentLength();
            if (type == null || !"video".equals(type.type()) || !"mp4".equals(type.subtype())) {
                throw new IllegalArgumentException("Seedance 结果不是 MP4 视频");
            }
            if (length <= 0 || length > properties.getTos().getMaxVideoBytes()) {
                throw new IllegalArgumentException("Seedance 视频大小无效");
            }
            StoredGenerationObject stored = storage.storeVideo(
                    jobId, 0, body.byteStream(), length, "video/mp4");
            return new VideoIngestedResult(stored, providerDurationSeconds);
        } catch (IOException exception) {
            throw new IllegalStateException("Seedance 视频下载失败", exception);
        }
    }

    private List<InetAddress> publicAddresses(Dns upstreamDns, String hostname)
            throws UnknownHostException {
        if (!isAllowedHost(hostname)) {
            throw new UnknownHostException("Seedance 结果域名不在允许列表");
        }
        List<InetAddress> addresses = upstreamDns.lookup(hostname);
        if (addresses.isEmpty() || addresses.stream().anyMatch(this::isNonPublicAddress)) {
            throw new UnknownHostException("Seedance 结果域名解析到非公网地址");
        }
        return addresses;
    }

    private boolean isAllowedHost(String host) {
        String normalized = host == null ? "" : host.toLowerCase(Locale.ROOT);
        return properties.getSeedance().getAllowedResultHostSuffixes().stream()
                .map(suffix -> suffix.toLowerCase(Locale.ROOT))
                .anyMatch(suffix -> normalized.equals(suffix)
                        || normalized.endsWith("." + suffix));
    }

    private boolean isNonPublicAddress(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress()
                || address.isMulticastAddress()) {
            return true;
        }
        byte[] bytes = address.getAddress();
        if (address instanceof Inet6Address) {
            return (bytes[0] & 0xfe) == 0xfc;
        }
        int first = bytes[0] & 0xff;
        int second = bytes[1] & 0xff;
        return first == 100 && second >= 64 && second <= 127;
    }
}
