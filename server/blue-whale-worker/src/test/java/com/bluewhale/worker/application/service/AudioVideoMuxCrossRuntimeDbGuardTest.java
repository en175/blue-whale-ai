package com.bluewhale.worker.application.service;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AudioVideoMuxCrossRuntimeDbGuardTest {
    private static Map<String, String> valid() {
        return new HashMap<>(Map.of(
                "IKIHPJ_CROSS_RUNTIME", "1",
                "IKIHPJ_CROSS_RUNTIME_JOB_ID", "70",
                "IKIHPJ_DB_GUARD_TOKEN", "0123456789abcdef0123456789abcdef",
                "IKIHPJ_EXTERNAL_DB_URL", "jdbc:mysql://host.docker.internal:43123/ikihpj_test_012345abcdef?allowPublicKeyRetrieval=true&useSSL=false",
                "IKIHPJ_STORAGE_UPLOAD_URL", "http://host.docker.internal:40001/stored/out.mp4",
                "IKIHPJ_STORAGE_PUBLIC_URL", "http://127.0.0.1:40001/stored/out.mp4"));
    }

    @Test
    void acceptsOnlyTheExplicitLocalEphemeralTargetShape() {
        var target = AudioVideoMuxCrossRuntimeDbGuard.validate(valid());
        assertThat(target.database()).isEqualTo("ikihpj_test_012345abcdef");
        assertThat(target.jobId()).isEqualTo("70");
        assertThat(AudioVideoMuxCrossRuntimeDbGuard.requested(Map.of("IKIHPJ_EXTERNAL_DB_URL", "jdbc:mysql://prod/db")))
                .isTrue();
    }

    @Test
    void rejectsAnExternalUrlWithoutTheCrossRuntimeOptIn() {
        var env = valid();
        env.remove("IKIHPJ_CROSS_RUNTIME");
        assertThatThrownBy(() -> AudioVideoMuxCrossRuntimeDbGuard.validate(env))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("IKIHPJ_CROSS_RUNTIME=1");
    }

    @Test
    void rejectsAnExternalUrlWithoutTheJobIdOrGuardToken() {
        var noJob = valid();
        noJob.remove("IKIHPJ_CROSS_RUNTIME_JOB_ID");
        assertThatThrownBy(() -> AudioVideoMuxCrossRuntimeDbGuard.validate(noJob))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("JOB_ID");
        var noToken = valid();
        noToken.remove("IKIHPJ_DB_GUARD_TOKEN");
        assertThatThrownBy(() -> AudioVideoMuxCrossRuntimeDbGuard.validate(noToken))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("GUARD_TOKEN");
    }

    @Test
    void rejectsProductionHostsOrNonEphemeralDatabaseNames() {
        var production = valid();
        production.put("IKIHPJ_EXTERNAL_DB_URL", "jdbc:mysql://db.production.internal:3306/bluewhale?allowPublicKeyRetrieval=true&useSSL=false");
        assertThatThrownBy(() -> AudioVideoMuxCrossRuntimeDbGuard.validate(production))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("隔离库");
        var shared = valid();
        shared.put("IKIHPJ_EXTERNAL_DB_URL", "jdbc:mysql://host.docker.internal:43123/bluewhale_test?allowPublicKeyRetrieval=true&useSSL=false");
        assertThatThrownBy(() -> AudioVideoMuxCrossRuntimeDbGuard.validate(shared))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("隔离库");
    }

    @Test
    void rejectsStorageEndpointsOutsideTheLocalTestHost() {
        var env = valid();
        env.put("IKIHPJ_STORAGE_UPLOAD_URL", "http://storage.production.internal:40001/stored/out.mp4");
        assertThatThrownBy(() -> AudioVideoMuxCrossRuntimeDbGuard.validate(env))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("存储替身");
    }
}
