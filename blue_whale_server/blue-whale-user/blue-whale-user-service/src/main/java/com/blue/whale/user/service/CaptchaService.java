package com.blue.whale.user.service;

import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.redis.utils.RedisUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 图形验证码服务（Redis）
 */
@Slf4j
@Service
public class CaptchaService {

    /** 字符集（避开 O/0/1/I/l） */
    private static final String CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    private static final int CODE_LENGTH = 4;
    private static final int IMG_WIDTH = 120;
    private static final int IMG_HEIGHT = 40;
    private static final int EXPIRE_SECONDS = 120; // 2分钟

    private static final String CAPTCHA_PREFIX = "bw:captcha:";

    private final SecureRandom random = new SecureRandom();

    public CaptchaResult generate() {
        String answer = generateRandomCode();
        String token = UUID.randomUUID().toString();
        String base64Image = generateImage(answer);

        RedisUtil.setCacheObject(CAPTCHA_PREFIX + token, answer, EXPIRE_SECONDS, TimeUnit.SECONDS);

        log.debug("生成图形验证码, token={}, answer={}", token, answer);
        return new CaptchaResult(token, base64Image);
    }

    public void verify(String token, String answer) {
        String stored = RedisUtil.getCacheObject(CAPTCHA_PREFIX + token);
        if (stored == null) {
            throw new GlobalException(400, "图形验证码已过期，请刷新重试");
        }
        if (!stored.equalsIgnoreCase(answer)) {
            throw new GlobalException(400, "图形验证码错误");
        }
        // 一次性消费
        RedisUtil.delete(CAPTCHA_PREFIX + token);
    }

    // ========== 内部方法（不变） ==========

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

        g.setColor(new Color(240, 240, 240));
        g.fillRect(0, 0, IMG_WIDTH, IMG_HEIGHT);

        g.setColor(new Color(200, 200, 200));
        for (int i = 0; i < 6; i++) {
            g.drawLine(random.nextInt(IMG_WIDTH), random.nextInt(IMG_HEIGHT),
                    random.nextInt(IMG_WIDTH), random.nextInt(IMG_HEIGHT));
        }

        int charWidth = IMG_WIDTH / (text.length() + 1);
        for (int i = 0; i < text.length(); i++) {
            g.setFont(new Font("Arial", Font.BOLD, 22 + random.nextInt(6)));
            g.setColor(new Color(40 + random.nextInt(80), 40 + random.nextInt(80), 50 + random.nextInt(100)));
            double radian = Math.toRadians(-15 + random.nextInt(30));
            double x = charWidth * (i + 1) - 15 + random.nextInt(10);
            double y = IMG_HEIGHT * 0.7 + random.nextInt(5);
            AffineTransform orig = g.getTransform();
            g.rotate(radian, x, y);
            g.drawString(String.valueOf(text.charAt(i)), (int) x, (int) y);
            g.setTransform(orig);
        }

        for (int i = 0; i < 50; i++) {
            img.setRGB(random.nextInt(IMG_WIDTH), random.nextInt(IMG_HEIGHT),
                    new Color(150, 150, 150).getRGB());
        }

        g.dispose();

        try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            ImageIO.write(img, "png", baos);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(baos.toByteArray());
        } catch (IOException e) {
            throw new RuntimeException("生成验证码图片失败", e);
        }
    }

    public record CaptchaResult(String token, String base64Image) {}
}
