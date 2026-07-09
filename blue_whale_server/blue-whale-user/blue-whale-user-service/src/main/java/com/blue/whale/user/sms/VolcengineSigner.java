package com.blue.whale.user.sms;

import lombok.extern.slf4j.Slf4j;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;

/**
 * 火山引擎 API V4 签名器（HMAC-SHA256）
 */
@Slf4j
public class VolcengineSigner {

    private static final String ALGORITHM = "HMAC-SHA256";
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    private final String region;
    private final String service;
    private final String schema;
    private final String host;
    private final String path;
    private final String ak;
    private final String sk;

    public VolcengineSigner(String region, String service, String schema,
                            String host, String path, String ak, String sk) {
        this.region = region;
        this.service = service;
        this.schema = schema;
        this.host = host;
        this.path = path;
        this.ak = ak;
        this.sk = sk;
    }

    /**
     * 发送签名请求
     */
    public String doRequest(String method, byte[] body, Date date,
                            String action, String version) throws Exception {
        String xDate = formatDate(date);
        String shortDate = xDate.substring(0, 8); // YYYYMMDD

        // Content-Sha256
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        String contentHash = bytesToHex(sha256.digest(body));

        // Canonical Query
        String canonicalQuery = "Action=" + action + "&Version=" + version;

        // Signed Headers (lowercase)
        String signedHeaders = "content-type;host;x-content-sha256;x-date";
        String contentType = "application/json";

        // Canonical Headers
        String canonicalHeaders = String.join("\n",
                "content-type:" + contentType,
                "host:" + host,
                "x-content-sha256:" + contentHash,
                "x-date:" + xDate
        ) + "\n";

        // Canonical Request
        String canonicalRequest = String.join("\n",
                method,
                path,
                canonicalQuery,
                canonicalHeaders,
                signedHeaders,
                contentHash
        );

        // String to Sign
        String credentialScope = shortDate + "/" + region + "/" + service + "/request";
        String stringToSign = String.join("\n",
                ALGORITHM,
                xDate,
                credentialScope,
                bytesToHex(sha256.digest(canonicalRequest.getBytes(StandardCharsets.UTF_8)))
        );

        // Signing Key
        byte[] kSecret = sk.getBytes(StandardCharsets.UTF_8);
        byte[] kDate = hmacSha256(kSecret, shortDate);
        byte[] kRegion = hmacSha256(kDate, region);
        byte[] kService = hmacSha256(kRegion, service);
        byte[] signingKey = hmacSha256(kService, "request");

        // Signature
        String signature = bytesToHex(hmacSha256Raw(signingKey, stringToSign));

        // Authorization Header
        String authorization = ALGORITHM + " Credential=" + ak + "/" + credentialScope
                + ", SignedHeaders=" + signedHeaders
                + ", Signature=" + signature;

        // HTTP Request
        String urlStr = schema + "://" + host + path + "?" + canonicalQuery;
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Host", host);
        conn.setRequestProperty("X-Date", xDate);
        conn.setRequestProperty("X-Content-Sha256", contentHash);
        conn.setRequestProperty("Content-Type", contentType);
        conn.setRequestProperty("Authorization", authorization);
        conn.setDoOutput(true);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(10000);

        try (OutputStream os = conn.getOutputStream()) {
            os.write(body);
        }

        int status = conn.getResponseCode();
        String response;
        try (java.util.Scanner scanner = new java.util.Scanner(
                status == 200 ? conn.getInputStream() : conn.getErrorStream(),
                StandardCharsets.UTF_8
        ).useDelimiter("\\A")) {
            response = scanner.hasNext() ? scanner.next() : "";
        }

        log.debug("火山短信: status={}, response={}", status, response);
        return response;
    }

    // ========== helpers ==========

    private String formatDate(Date date) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'");
        sdf.setTimeZone(UTC);
        return sdf.format(date);
    }

    private byte[] hmacSha256(byte[] key, String data) throws Exception {
        return hmacSha256Raw(key, data.getBytes(StandardCharsets.UTF_8));
    }

    private byte[] hmacSha256Raw(byte[] key, byte[] data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private byte[] hmacSha256Raw(byte[] key, String data) throws Exception {
        return hmacSha256Raw(key, data.getBytes(StandardCharsets.UTF_8));
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
