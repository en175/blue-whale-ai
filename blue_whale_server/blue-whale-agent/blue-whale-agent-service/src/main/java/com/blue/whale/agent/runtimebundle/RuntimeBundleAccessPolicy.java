package com.blue.whale.agent.runtimebundle;

import com.blue.whale.agent.common.context.UserContext;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class RuntimeBundleAccessPolicy {

    private final Set<Long> adminUserIds;
    private final Set<String> workerIds;

    RuntimeBundleAccessPolicy(
            @Value("${blue-whale.runtime-bundle.admin-user-ids:}") String configuredAdminUserIds,
            @Value("${blue-whale.runtime-bundle.worker-ids:}") String configuredWorkerIds) {
        adminUserIds = Arrays.stream(configuredAdminUserIds.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .map(Long::valueOf)
                .collect(Collectors.toUnmodifiableSet());
        workerIds = Arrays.stream(configuredWorkerIds.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    Long requireAdmin(Long userId) {
        Long authenticated = UserContext.requireUserId(userId);
        if (!adminUserIds.contains(authenticated)) {
            throw new GlobalException(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE, "无权管理 Runtime Bundle");
        }
        return authenticated;
    }

    String requireWorker(String workerId) {
        if (workerId == null || !workerIds.contains(workerId)) {
            throw new GlobalException(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE,
                    "无权读取 Runtime Bundle 发布快照");
        }
        return workerId;
    }
}
