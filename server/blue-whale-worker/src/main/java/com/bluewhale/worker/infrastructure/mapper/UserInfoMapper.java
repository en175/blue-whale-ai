package com.bluewhale.worker.infrastructure.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 用户上游凭证 Mapper（ADR-0087 决策 4）。
 * <p>
 * 为什么需要这张表：网关 {@code /api/material/*} 只认用户 sk-（无服务级通道），
 * 而定时跟进发生在任何请求之外——没有会话可借。登录时把 sk- 落 user_info
 * （backend auth.controller establishSession），worker 按 user_id 取回。
 * <p>
 * 这是 users 表之外的独立表，不碰遗留 users（其 id 与 new-api userId 不同源）。
 */
@Mapper
public interface UserInfoMapper {

    /**
     * 取该用户的上游执行凭证（sk-）。无行返回 null——用户从未在本栈登录过，
     * 跟进只能跳过，等下轮再试（不报错、不落库）。
     */
    @Select("""
            SELECT provider_credential FROM user_info
            WHERE user_id = #{userId}
            LIMIT 1
            """)
    String findCredential(@Param("userId") long userId);
}
