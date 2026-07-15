package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.redis.utils.RedisUtil;
import com.blue.whale.user.config.JwtUtil;
import com.blue.whale.user.dto.LoginResponse;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import com.blue.whale.user.sms.SmsProvider;
import io.jsonwebtoken.Claims;
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
    private final SmsProvider smsProvider;
    private final JwtUtil jwtUtil;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    // Redis key 前缀
    private static final String SMS_CODE_PREFIX = "bw:sms:code:";
    private static final String SMS_LIMIT_60S_PREFIX = "bw:sms:limit:60s:";
    private static final String SMS_LIMIT_DAILY_PREFIX = "bw:sms:limit:daily:";
    private static final String SMS_LIMIT_IP_PREFIX = "bw:sms:limit:ip:";
    /** 测试账号：跳过图形验证码和短信验证码 */
    private static final String TEST_PHONE = "15079999999";

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

    public void sendCode(String phone, String ip) {
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
        boolean isTestPhone = TEST_PHONE.equals(phone);

        if (!isTestPhone) {
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
        }

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

        // 生成双 token
        String userIdStr = String.valueOf(user.getId());
        String accessToken = jwtUtil.generateAccessToken(userIdStr, phone);
        String refreshToken = jwtUtil.generateRefreshToken(userIdStr);

        // refresh_token 存 Redis（key: jti → userId），30天过期
        var claims = jwtUtil.parse(refreshToken);
        RedisUtil.setCacheObject(
                REFRESH_TOKEN_PREFIX + claims.getId(),
                userIdStr,
                2_592_000,  // 30 天
                TimeUnit.SECONDS
        );

        return LoginResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .expiresIn(jwtUtil.getAccessExpiration())
                .userId(user.getId())
                .username(user.getUsername())
                .phone(user.getPhone())
                .avatar(user.getAvatar())
                .isNewUser(isNewUser)
                .build();
    }

    // ==================== 刷新 Token ====================

    private static final String REFRESH_TOKEN_PREFIX = "bw:refresh:";

    public LoginResponse refresh(String refreshToken) {
        Claims claims;
        try {
            claims = jwtUtil.parse(refreshToken);
        } catch (Exception e) {
            throw new GlobalException(401, "refresh_token 无效或已过期");
        }

        // 校验 Redis 中是否存在
        String userId = RedisUtil.getCacheObject(REFRESH_TOKEN_PREFIX + claims.getId());
        if (userId == null) {
            throw new GlobalException(401, "refresh_token 已失效，请重新登录");
        }

        // 删旧 refresh_token
        RedisUtil.delete(REFRESH_TOKEN_PREFIX + claims.getId());

        // 查用户
        User user = userMapper.selectById(Long.valueOf(userId));
        if (user == null) {
            throw new GlobalException(401, "用户不存在");
        }

        // 发新双 token
        String newAccess = jwtUtil.generateAccessToken(userId, user.getPhone());
        String newRefresh = jwtUtil.generateRefreshToken(userId);
        var newClaims = jwtUtil.parse(newRefresh);
        RedisUtil.setCacheObject(
                REFRESH_TOKEN_PREFIX + newClaims.getId(),
                userId,
                2_592_000,  // 30 天
                TimeUnit.SECONDS
        );

        return LoginResponse.builder()
                .accessToken(newAccess)
                .refreshToken(newRefresh)
                .expiresIn(jwtUtil.getAccessExpiration())
                .userId(user.getId())
                .username(user.getUsername())
                .phone(user.getPhone())
                .avatar(user.getAvatar())
                .isNewUser(false)
                .build();
    }

    // ==================== 登出 ====================

    /** 登出：删 refresh_token */
    public void logout(String refreshToken) {
        try {
            var claims = jwtUtil.parse(refreshToken);
            RedisUtil.delete(REFRESH_TOKEN_PREFIX + claims.getId());
            log.debug("登出成功: jti={}", claims.getId());
        } catch (Exception e) {
            log.debug("登出时 token 已过期或无效: {}", e.getMessage());
        }
    }

    // ==================== 换绑手机号 ====================

    private static final String CHANGE_PHONE_CODE_PREFIX = "bw:sms:code:change:";

    /**
     * 向新手机号发送验证码（用于换绑）
     */
    public void sendChangePhoneCode(String userId, String newPhone, String ip) {
        boolean isTestPhone = TEST_PHONE.equals(newPhone);

        if (!newPhone.matches("1[3-9]\\d{9}")) {
            throw new GlobalException(400, "手机号格式不正确");
        }

        // 检查新手机号是否已被占用
        Long count = userMapper.selectCount(
                new LambdaQueryWrapper<User>()
                        .eq(User::getPhone, newPhone)
                        .ne(User::getId, Long.valueOf(userId))
        );
        if (count > 0) {
            throw new GlobalException(400, "该手机号已被其他账号绑定");
        }

        if (!isTestPhone) {
            // 60s 限流
            String intervalKey = SMS_LIMIT_60S_PREFIX + newPhone;
            if (RedisUtil.getCacheObject(intervalKey) != null) {
                throw new GlobalException(429, "发送过于频繁，请60秒后再试");
            }
            RedisUtil.setCacheObject(intervalKey, "1", (int) SEND_INTERVAL_SEC, TimeUnit.SECONDS);

            // IP 小时限流
            String ipKey = SMS_LIMIT_IP_PREFIX + ip;
            Long ipCount = incrWithTTL(ipKey, 3600);
            if (ipCount > IP_HOURLY_LIMIT) {
                throw new GlobalException(429, "操作过于频繁，请稍后再试");
            }
        }

        String code = isTestPhone ? "1234" : generateCode();
        log.info("换绑手机号验证码: oldUserId={}, newPhone={}, code={}", userId, newPhone, code);

        RedisUtil.setCacheObject(CHANGE_PHONE_CODE_PREFIX + newPhone, code,
                CODE_EXPIRE_SEC, TimeUnit.SECONDS);

        if (!isTestPhone) {
            smsProvider.send(newPhone, code);
        }
    }

    /**
     * 校验验证码并更换手机号
     */
    public void changePhone(String userId, String newPhone, String code) {
        boolean isTestPhone = TEST_PHONE.equals(newPhone);

        if (!isTestPhone) {
            String stored = RedisUtil.getCacheObject(CHANGE_PHONE_CODE_PREFIX + newPhone);
            if (stored == null) {
                throw new GlobalException(401, "验证码已过期，请重新获取");
            }
            if (!stored.equals(code)) {
                throw new GlobalException(401, "验证码错误");
            }
            RedisUtil.delete(CHANGE_PHONE_CODE_PREFIX + newPhone);
        }

        // 检查占用
        Long count = userMapper.selectCount(
                new LambdaQueryWrapper<User>()
                        .eq(User::getPhone, newPhone)
                        .ne(User::getId, Long.valueOf(userId))
        );
        if (count > 0) {
            throw new GlobalException(400, "该手机号已被其他账号绑定");
        }

        userMapper.update(null,
                new LambdaUpdateWrapper<User>()
                        .eq(User::getId, Long.valueOf(userId))
                        .set(User::getPhone, newPhone)
                        .set(User::getGmtModified, LocalDateTime.now())
        );

        log.info("手机号更换成功: userId={}, newPhone={}", userId, newPhone);
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
