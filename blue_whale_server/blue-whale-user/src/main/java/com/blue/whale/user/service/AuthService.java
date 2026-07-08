package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.redis.utils.RedisUtil;
import com.blue.whale.user.config.JwtUtil;
import com.blue.whale.user.dto.LoginResponse;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import com.blue.whale.user.sms.SmsProvider;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/**
 * 认证服务：发验证码 / 登录注册（Redis 限流 + 存储）
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserMapper userMapper;
    private final CaptchaService captchaService;
    private final SmsProvider smsProvider;
    private final JwtUtil jwtUtil;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    // Redis key 前缀
    private static final String SMS_CODE_PREFIX = "bw:sms:code:";
    private static final String SMS_LIMIT_60S_PREFIX = "bw:sms:limit:60s:";
    private static final String SMS_LIMIT_DAILY_PREFIX = "bw:sms:limit:daily:";
    private static final String SMS_LIMIT_IP_PREFIX = "bw:sms:limit:ip:";

    /** 验证码有效期（秒） */
    private static final int CODE_EXPIRE_SEC = 300;
    /** 单手机号发送间隔（秒） */
    private static final long SEND_INTERVAL_SEC = 60;
    /** 单手机号每天上限 */
    private static final int PHONE_DAILY_LIMIT = 10;
    /** 单IP每小时上限 */
    private static final int IP_HOURLY_LIMIT = 20;
    /** 验证码长度 */
    private static final int CODE_LENGTH = 6;

    // ==================== 发码 ====================

    public void sendCode(String phone, String ip, String captchaToken, String captchaAnswer) {
        // 层4：图形验证码
        captchaService.verify(captchaToken, captchaAnswer);

        // 手机号格式校验
        if (!phone.matches("1[3-9]\\d{9}")) {
            throw new GlobalException(400, "手机号格式不正确");
        }

        // 层2：单手机号日限（原子 INCR）
        String dailyKey = SMS_LIMIT_DAILY_PREFIX + phone;
        Long dailyCount = incrWithTTL(dailyKey, (int) secondsUntilMidnight());
        if (dailyCount > PHONE_DAILY_LIMIT) {
            throw new GlobalException(429, "该手机号今日发送次数已达上限");
        }

        // 层3：同IP小时限
        String ipKey = SMS_LIMIT_IP_PREFIX + ip;
        Long ipCount = incrWithTTL(ipKey, 3600);
        if (ipCount > IP_HOURLY_LIMIT) {
            throw new GlobalException(429, "操作过于频繁，请稍后再试");
        }

        // 层1：同手机号60s间隔
        String intervalKey = SMS_LIMIT_60S_PREFIX + phone;
        if (RedisUtil.getCacheObject(intervalKey) != null) {
            throw new GlobalException(429, "发送过于频繁，请60秒后再试");
        }
        RedisUtil.setCacheObject(intervalKey, "1", (int) SEND_INTERVAL_SEC, TimeUnit.SECONDS);

        // 生成验证码
        String code = generateCode();
        log.info("生成验证码: phone={}, code={}", phone, code);

        // 存 Redis（5分钟）
        RedisUtil.setCacheObject(SMS_CODE_PREFIX + phone, code, CODE_EXPIRE_SEC, TimeUnit.SECONDS);

        // 发短信
        smsProvider.send(phone, code);
    }

    // ==================== 登录 ====================

    @Transactional(rollbackFor = Exception.class)
    public LoginResponse login(String phone, String code) {
        // 从 Redis 取验证码
        String stored = RedisUtil.getCacheObject(SMS_CODE_PREFIX + phone);
        if (stored == null) {
            throw new GlobalException(401, "验证码已过期，请重新获取");
        }
        if (!stored.equals(code)) {
            throw new GlobalException(401, "验证码错误");
        }

        // 消费掉
        RedisUtil.delete(SMS_CODE_PREFIX + phone);

        // 查用户：有则登录，无则注册
        User user = userMapper.selectOne(
                new LambdaQueryWrapper<User>()
                        .eq(User::getPhone, phone)
                        .last("LIMIT 1")
        );

        boolean isNewUser = (user == null);
        if (isNewUser) {
            user = new User()
                    .setPhone(phone)
                    .setUsername(generateUsername())
                    .setStatus("NORMAL");
            user.setGmtCreate(LocalDateTime.now());
            user.setGmtModified(LocalDateTime.now());
            user.setVersion(1);
            user.setDeleted(false);
            userMapper.insert(user);
            log.info("新用户注册: id={}, phone={}, username={}", user.getId(), phone, user.getUsername());
        } else {
            log.info("用户登录: id={}, phone={}", user.getId(), phone);
        }

        // 生成 JWT
        String token = jwtUtil.generate(String.valueOf(user.getId()), phone);

        return LoginResponse.builder()
                .token(token)
                .userId(user.getId())
                .username(user.getUsername())
                .phone(user.getPhone())
                .isNewUser(isNewUser)
                .build();
    }

    // ==================== 登出 ====================

    /** token 黑名单 key */
    public static final String TOKEN_BLACKLIST_PREFIX = "bw:token:blacklist:";

    public void logout(String token) {
        // 存到黑名单，TTL 对齐 JWT 剩余有效期
        try {
            var claims = jwtUtil.parse(token);
            long remaining = claims.getExpiration().getTime() - System.currentTimeMillis();
            if (remaining > 0) {
                RedisUtil.setCacheObject(
                        TOKEN_BLACKLIST_PREFIX + token.hashCode(),
                        "1",
                        (int) (remaining / 1000),
                        TimeUnit.SECONDS
                );
            }
        } catch (Exception e) {
            log.debug("登出时 token 已过期或无效: {}", e.getMessage());
        }
    }

    public static boolean isTokenBlacklisted(String token) {
        return RedisUtil.getCacheObject(TOKEN_BLACKLIST_PREFIX + token.hashCode()) != null;
    }

    // ==================== 内部方法 ====================

    private String generateCode() {
        int code = SECURE_RANDOM.nextInt(1_000_000);
        return String.format("%06d", code);
    }

    private String generateUsername() {
        String username;
        int maxRetries = 20;
        do {
            int n = ThreadLocalRandom.current().nextInt(10000);
            username = "用户" + String.format("%04d", n);
            Long count = userMapper.selectCount(
                    new LambdaQueryWrapper<User>().eq(User::getUsername, username)
            );
            if (count == 0) return username;
        } while (--maxRetries > 0);
        return "用户" + System.currentTimeMillis() % 100000;
    }

    private long secondsUntilMidnight() {
        LocalTime midnight = LocalTime.MAX; // 23:59:59.999999999
        return java.time.Duration.between(LocalTime.now(), midnight).getSeconds() + 1;
    }

    /**
     * 原子 INCR + TTL。返回递增后的值；首次访问时设 TTL。
     */
    private Long incrWithTTL(String key, int ttlSeconds) {
        ValueOperations<String, Object> ops = RedisUtil.getRedisTemplate().opsForValue();
        Long count = ops.increment(key);
        if (count != null && count == 1) {
            RedisUtil.getRedisTemplate().expire(key, ttlSeconds, TimeUnit.SECONDS);
        }
        return count == null ? 0L : count;
    }
}
