package com.bluewhale.worker.application.service;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AudioMixCrossRuntimeDbGuardTest {
    private static Map<String, String> valid() {
        return new HashMap<>(Map.of(
                "IKI68N_CROSS_RUNTIME", "1",
                "IKI68N_CROSS_RUNTIME_JOB_ID", "70",
                "IKI68N_DB_GUARD_TOKEN", "0123456789abcdef0123456789abcdef",
                "IKI68N_EXTERNAL_DB_URL", "jdbc:mysql://host.docker.internal:43123/iki68n_test_012345abcdef?allowPublicKeyRetrieval=true&useSSL=false",
                "IKI68N_STORAGE_UPLOAD_URL", "http://host.docker.internal:40001/stored/out.mp3",
                "IKI68N_STORAGE_PUBLIC_URL", "http://127.0.0.1:40001/stored/out.mp3"));
    }

    @Test
    void acceptsOnlyTheExplicitLocalEphemeralTargetShape() {
        var target = AudioMixCrossRuntimeDbGuard.validate(valid());
        assertThat(target.database()).isEqualTo("iki68n_test_012345abcdef");
        assertThat(target.jobId()).isEqualTo("70");
        assertThat(AudioMixCrossRuntimeDbGuard.requested(Map.of("IKI68N_EXTERNAL_DB_URL", "jdbc:mysql://prod/db")))
                .isTrue();
    }

    @Test
    void rejectsAnExternalUrlWithoutTheCrossRuntimeOptIn() {
        var env = valid();
        env.remove("IKI68N_CROSS_RUNTIME");
        assertThatThrownBy(() -> AudioMixCrossRuntimeDbGuard.validate(env))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("IKI68N_CROSS_RUNTIME=1");
    }

    @Test
    void rejectsAnExternalUrlWithoutTheJobIdOrGuardToken() {
        var noJob = valid();
        noJob.remove("IKI68N_CROSS_RUNTIME_JOB_ID");
        assertThatThrownBy(() -> AudioMixCrossRuntimeDbGuard.validate(noJob))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("JOB_ID");
        var noToken = valid();
        noToken.remove("IKI68N_DB_GUARD_TOKEN");
        assertThatThrownBy(() -> AudioMixCrossRuntimeDbGuard.validate(noToken))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("GUARD_TOKEN");
    }

    @Test
    void rejectsProductionHostsOrNonEphemeralDatabaseNames() {
        var production = valid();
        production.put("IKI68N_EXTERNAL_DB_URL", "jdbc:mysql://db.production.internal:3306/bluewhale?allowPublicKeyRetrieval=true&useSSL=false");
        assertThatThrownBy(() -> AudioMixCrossRuntimeDbGuard.validate(production))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("隔离库");
        var shared = valid();
        shared.put("IKI68N_EXTERNAL_DB_URL", "jdbc:mysql://host.docker.internal:43123/bluewhale_test?allowPublicKeyRetrieval=true&useSSL=false");
        assertThatThrownBy(() -> AudioMixCrossRuntimeDbGuard.validate(shared))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("隔离库");
    }

    @Test
    void rejectsStorageEndpointsOutsideTheLocalTestHost() {
        var env = valid();
        env.put("IKI68N_STORAGE_UPLOAD_URL", "http://storage.production.internal:40001/stored/out.mp3");
        assertThatThrownBy(() -> AudioMixCrossRuntimeDbGuard.validate(env))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("存储替身");
    }
}
