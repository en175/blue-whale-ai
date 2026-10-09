package com.bluewhale.worker.application.service;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.regex.Pattern;

final class AudioVideoMuxCrossRuntimeDbGuard {
    private static final Pattern JDBC_URL = Pattern.compile(
            "^jdbc:mysql://host\\.docker\\.internal:([0-9]{1,5})/(ikihpj_test_[0-9a-f]{12})"
                    + "\\?allowPublicKeyRetrieval=true&useSSL=false$");
    private static final Pattern UPLOAD_URL = Pattern.compile(
            "^http://host\\.docker\\.internal:([0-9]{1,5})/stored/out\\.mp4$");
    private static final Pattern PUBLIC_URL = Pattern.compile(
            "^http://127\\.0\\.0\\.1:([0-9]{1,5})/stored/out\\.mp4$");

    private AudioVideoMuxCrossRuntimeDbGuard() {}

    static boolean requested(Map<String, String> env) {
        return env.keySet().stream().anyMatch(key -> key.startsWith("IKIHPJ_"));
    }

    static Target validate(Map<String, String> env) {
        if (!"1".equals(env.get("IKIHPJ_CROSS_RUNTIME"))) {
            throw new IllegalStateException("跨端测试须显式设置 IKIHPJ_CROSS_RUNTIME=1");
        }
        String jobId = env.get("IKIHPJ_CROSS_RUNTIME_JOB_ID");
        if (jobId == null || !jobId.matches("[1-9][0-9]*")) {
            throw new IllegalStateException("跨端测试须提供有效的 IKIHPJ_CROSS_RUNTIME_JOB_ID");
        }
        String token = env.get("IKIHPJ_DB_GUARD_TOKEN");
        if (token == null || !token.matches("[0-9a-f]{32}")) {
            throw new IllegalStateException("跨端测试须提供随机的 IKIHPJ_DB_GUARD_TOKEN");
        }
        String jdbcUrl = env.get("IKIHPJ_EXTERNAL_DB_URL");
        var jdbc = JDBC_URL.matcher(jdbcUrl == null ? "" : jdbcUrl);
        if (!jdbc.matches() || !validPort(jdbc.group(1))) {
            throw new IllegalStateException("跨端测试数据库仅允许本地 Docker 隔离库 ikihpj_test_*");
        }
        var upload = UPLOAD_URL.matcher(env.getOrDefault("IKIHPJ_STORAGE_UPLOAD_URL", ""));
        var publicUrl = PUBLIC_URL.matcher(env.getOrDefault("IKIHPJ_STORAGE_PUBLIC_URL", ""));
        if (!upload.matches() || !publicUrl.matches() || !validPort(upload.group(1))
                || !upload.group(1).equals(publicUrl.group(1))) {
            throw new IllegalStateException("跨端测试存储替身须同端口绑定本机地址");
        }
        return new Target(jdbcUrl, jdbc.group(2), jobId, token,
                env.get("IKIHPJ_STORAGE_UPLOAD_URL"), env.get("IKIHPJ_STORAGE_PUBLIC_URL"));
    }

    static void verifyMarker(Target target) {
        try (var connection = DriverManager.getConnection(target.jdbcUrl(), "test", "test")) {
            connection.setReadOnly(true);
            try (var database = connection.createStatement().executeQuery("SELECT DATABASE()")) {
                if (!database.next() || !target.database().equals(database.getString(1))) {
                    throw new IllegalStateException("隔离库名称与连接目标不一致");
                }
            }
            try (var statement = connection.prepareStatement(
                    "SELECT guard_token FROM ikihpj_test_guard WHERE guard_token=?")) {
                statement.setString(1, target.token());
                try (var result = statement.executeQuery()) {
                    if (!result.next()) throw new IllegalStateException("隔离库标记不匹配");
                }
            }
        } catch (SQLException error) {
            throw new IllegalStateException("隔离库标记验证失败", error);
        }
    }

    private static boolean validPort(String raw) {
        int port = Integer.parseInt(raw);
        return port > 0 && port <= 65535;
    }

    record Target(String jdbcUrl, String database, String jobId, String token,
                  String storageUploadUrl, String storagePublicUrl) {}
}
