package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.user.entity.CaptchaChallenge;
import com.blue.whale.user.mapper.CaptchaChallengeMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.UUID;

/**
 * 图形验证码服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CaptchaService {

    private final CaptchaChallengeMapper captchaChallengeMapper;

    /** 字符集（避开 O/0/1/I/l） */
    private static final String CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    private static final int CODE_LENGTH = 4;
    private static final int IMG_WIDTH = 120;
    private static final int IMG_HEIGHT = 40;
    /** 验证码有效期：2分钟 */
    private static final int EXPIRE_MINUTES = 2;

    private final SecureRandom random = new SecureRandom();

    /**
     * 生成图形验证码
     *
     * @return { token, base64Image }
     */
    public CaptchaResult generate() {
        String answer = generateRandomCode();
        String token = UUID.randomUUID().toString();
        String base64Image = generateImage(answer);

        // 存入数据库
        CaptchaChallenge challenge = new CaptchaChallenge()
                .setToken(token)
                .setAnswer(answer)
                .setGmtExpire(LocalDateTime.now().plusMinutes(EXPIRE_MINUTES))
                .setIsVerified(false)
                .setGmtCreate(LocalDateTime.now());
        captchaChallengeMapper.insert(challenge);

        log.debug("生成图形验证码, token={}, answer={}", token, answer);
        return new CaptchaResult(token, base64Image);
    }

    /**
     * 校验图形验证码（一次性消费）
     */
    public void verify(String token, String answer) {
        CaptchaChallenge challenge = captchaChallengeMapper.selectOne(
                new LambdaQueryWrapper<CaptchaChallenge>()
                        .eq(CaptchaChallenge::getToken, token)
                        .eq(CaptchaChallenge::getIsVerified, false)
                        .gt(CaptchaChallenge::getGmtExpire, LocalDateTime.now())
                        .orderByDesc(CaptchaChallenge::getGmtCreate)
                        .last("LIMIT 1")
        );

        if (challenge == null) {
            throw new GlobalException(400, "图形验证码已过期，请刷新重试");
        }

        if (!challenge.getAnswer().equalsIgnoreCase(answer)) {
            throw new GlobalException(400, "图形验证码错误");
        }

        // 标记已用
        challenge.setIsVerified(true);
        captchaChallengeMapper.updateById(challenge);
    }

    // ========== 内部方法 ==========

    private String generateRandomCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(CHARS.charAt(random.nextInt(CHARS.length())));
        }
        return sb.toString();
    }

    private String generateImage(String text) {
        BufferedImage img = new BufferedImage(IMG_WIDTH, IMG_HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();

        // 白色背景
        g.setColor(new Color(240, 240, 240));
        g.fillRect(0, 0, IMG_WIDTH, IMG_HEIGHT);

        // 干扰线
        g.setColor(new Color(200, 200, 200));
        for (int i = 0; i < 6; i++) {
            int x1 = random.nextInt(IMG_WIDTH);
            int y1 = random.nextInt(IMG_HEIGHT);
            int x2 = random.nextInt(IMG_WIDTH);
            int y2 = random.nextInt(IMG_HEIGHT);
            g.drawLine(x1, y1, x2, y2);
        }

        // 写字符（带旋转）
        int charWidth = IMG_WIDTH / (text.length() + 1);
        for (int i = 0; i < text.length(); i++) {
            String ch = String.valueOf(text.charAt(i));
            g.setFont(new Font("Arial", Font.BOLD, 22 + random.nextInt(6)));
            g.setColor(new Color(40 + random.nextInt(80), 40 + random.nextInt(80), 50 + random.nextInt(100)));

            // 旋转
            double radian = Math.toRadians(-15 + random.nextInt(30));
            double x = charWidth * (i + 1) - 15 + random.nextInt(10);
            double y = IMG_HEIGHT * 0.7 + random.nextInt(5);
            AffineTransform orig = g.getTransform();
            g.rotate(radian, x, y);
            g.drawString(ch, (int) x, (int) y);
            g.setTransform(orig);
        }

        // 噪点
        for (int i = 0; i < 50; i++) {
            img.setRGB(random.nextInt(IMG_WIDTH), random.nextInt(IMG_HEIGHT),
                    new Color(150, 150, 150).getRGB());
        }

        g.dispose();

        // 转 Base64
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            ImageIO.write(img, "png", baos);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(baos.toByteArray());
        } catch (IOException e) {
            throw new RuntimeException("生成验证码图片失败", e);
        }
    }

    /**
     * 图形验证码返回结果
     */
    public record CaptchaResult(String token, String base64Image) {
    }
}
