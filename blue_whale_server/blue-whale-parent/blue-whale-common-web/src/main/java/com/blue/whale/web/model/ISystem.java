package com.blue.whale.web.model;

import com.blue.whale.global.constants.GlobalCodeConstant;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.web.context.SystemContextHolder;
import io.vavr.control.Option;

import java.util.function.Supplier;

/**
 * ISystem
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
public interface ISystem {

    /**
     * 获取系统信息
     *
     * @return 可能为空的系统信息
     */
    static Option<Systems> systemOpt() {
        return Option.of(SystemContextHolder.get());
    }

    /**
     * 获取系统信息
     *
     * @return 系统信息
     */
    static Systems systemMust() {
        return systemOpt().getOrElseThrow(() -> new GlobalException(GlobalCodeConstant.REQUEST_INVALID, "bad request"));
    }

    /**
     * 客户端ip
     *
     * @return 可能为空的ip
     */
    static Option<String> ipOpt() {
        return systemOpt().map(Systems::getIp);
    }

    /**
     * 客户端ip
     *
     * @return ip
     */
    static String ipMust() {
        return ipOpt().getOrElseThrow(() -> new GlobalException(GlobalCodeConstant.REQUEST_INVALID, "bad request"));
    }


    /**
     * 设备id
     *
     * @return 可能为空的设备id
     */
    static Option<String> deviceIdOpt() {
        return systemOpt().map(Systems::getDeviceId);
    }

    /**
     * 设备id
     *
     * @return 设备id
     */
    static String deviceIdMust() {
        return deviceIdOpt().getOrElseThrow(() -> new GlobalException(GlobalCodeConstant.REQUEST_INVALID, "bad request"));
    }

    /**
     * companyId 可能为空
     *
     * @return shopId 可能为空
     */
    static Option<Long> companyIdOpt() {
        return systemOpt().map(Systems::getCompanyId);
    }

    /**
     * companyId 必须有值
     *
     * @return companyId
     */
    static Long companyIdMust() {
        return companyIdOpt().getOrElseThrow(() -> new GlobalException(GlobalCodeConstant.REQUEST_INVALID, "bad request"));
    }

    /**
     * 修改companyId 并执行后续操作
     * 并且 在后续操完成后 修改回原来的companyId
     *
     * @param companyId  companyId
     * @param factory 后续操作
     * @param <T>     后续操作返回值类型
     * @return 后续操作返回值
     */
    static <T> T companyId(Long companyId, Supplier<T> factory) {
        Systems systems = ISystem.systemOpt()
                .getOrElse(() -> {
                    Systems newSystems = new Systems();
                    SystemContextHolder.set(newSystems);
                    return newSystems;
                });
        Long preCompanyId = systems.getCompanyId();
        systems.setCompanyId(companyId);
        try {
            return factory.get();
        } finally {
            if (preCompanyId == null) {
                SystemContextHolder.clear();
            } else {
                systems.setCompanyId(preCompanyId);
            }
        }
    }

    /**
     * 修改companyId 并执行后续操作
     * 并且 在后续操完成后 修改回原来的companyId
     *
     * @param companyId   companyId
     * @param runnable 后续操作
     */
    static void companyId(Long companyId, Runnable runnable) {
        ISystem.companyId(companyId, () -> {
            runnable.run();
            return null;
        });
    }
}
