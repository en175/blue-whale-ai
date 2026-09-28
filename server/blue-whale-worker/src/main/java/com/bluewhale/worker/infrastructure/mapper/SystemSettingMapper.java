package com.bluewhale.worker.infrastructure.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 系统设置读取（`system_settings`，管理端可配）。
 * <p>
 * <b>为什么 worker 直连这张表</b>（ADR-0113 数据主权的例外口径，务必读完再动）：
 * ADR-0113 决策 8 的原文是「数据主权严格（**禁止跨服务直连 DB**，既有例外为
 * **worker-java 直连 generation DB**）」——`system_settings` 就落在 worker 本就在读的
 * generation 库（`blue_whale`）里，属于**既有例外的射程内**，不是新开的口子。
 * 反方向的「开个内部端点让 worker 去 backend 取」反而更糟：它会把
 * 「worker 与 backend **仅经 DB + MQ 交互**」（CLAUDE.md 红线 #10 / ADR-0084 修正二）
 * 这条硬边界撞开，并在 worker 的 5s 定时链路上新挂一个对 backend 的强依赖。
 * <p>
 * 本 Mapper **只读不写**：设置由管理端（backend）写，worker 永远不做第二个写入者。
 * 取到的是**原文**——`is_secret=1` 的行是密文信封，解密在
 * {@link com.bluewhale.worker.config.SystemSettingEnvelope}。
 */
@Mapper
public interface SystemSettingMapper {

    /**
     * 按 key 取设置行原文。不存在返回 {@code null}（调用方按「未配置」处置，不得当空串用）。
     */
    @Select("SELECT setting_value FROM system_settings WHERE setting_key = #{key}")
    String selectValue(@Param("key") String key);
}
