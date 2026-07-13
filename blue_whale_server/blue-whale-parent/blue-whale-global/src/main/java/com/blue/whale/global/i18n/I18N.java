package com.blue.whale.global.i18n;

import cn.hutool.core.collection.CollUtil;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.lang.Nullable;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.ServiceLoader;
import java.util.Set;

/**
 * I18N
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description: 国际化 工具类 用于获取国际化消息
 */
public class I18N {
    /**
     * 国际化配置路径
     */
    private static final Set<String> PATHS = new HashSet<>();
    /**
     * 国际化消息源
     */
    private volatile static MessageSource messageSource;


    /**
     * 获取国际化消息
     *
     * @param code 消息code
     * @return 消息
     */
    public static String msg(String code) {
        return I18N.msg(code, (Object[]) null);
    }

    /**
     * 使用系统默认locale 获取国际化消息
     *
     * @param code 消息code
     * @return 国际化消息
     */
    public static String msgDefault(String code) {
        return I18N.msg(code, Locale.getDefault());
    }

    /**
     * 获取国际化消息
     *
     * @param code 消息code
     * @param args 参数
     * @return 消息
     */
    public static String msg(String code, @Nullable Object... args) {
        return I18N.msg(code, getLocale(), args);
    }

    /**
     * 获取国际化消息 指定语言
     *
     * @param code   消息code
     * @param locale 本地化 信息
     * @return 消息
     */
    public static String msg(String code, Locale locale) {
        return I18N.msg(code, locale, (Object[]) null);
    }


    /**
     * 获取国际化消息
     *
     * @param code   消息code
     * @param locale 本地化 信息
     * @param args   参数信息
     * @return 消息
     */
    public static synchronized String msg(String code, Locale locale, @Nullable Object... args) {
        return I18N.messageSource().getMessage(code, args, locale);
    }

    /**
     * DCL 获取国际化消息源 {@link MessageSource}
     *
     * @return 消息源
     */
    public static MessageSource messageSource() {
        if (I18N.messageSource != null) {
            return I18N.messageSource;
        }
        synchronized (I18N.class) {
            if (I18N.messageSource == null) {
                ResourceBundleMessageSource messageSource = new ResourceBundleMessageSource();
                messageSource.setBasenames(I18N.paths().toArray(new String[0]));
                messageSource.setDefaultEncoding(StandardCharsets.UTF_8.name());
                messageSource.setFallbackToSystemLocale(true);
                messageSource.setUseCodeAsDefaultMessage(true);
                I18N.setMessageSource(messageSource);
            }
        }
        return I18N.messageSource;
    }

    /**
     * 获取国际化配置路径
     *
     * @return 路径集合
     */
    public static Set<String> paths() {
        if (CollUtil.isEmpty(PATHS)) {
            ServiceLoader.load(I18NPropertiesLoader.class)
                    .forEach(loader -> PATHS.addAll(loader.paths()));
        }
        return PATHS;
    }

    /**
     * 获取本地化信息 上下文不存在则默认使用简体中文
     *
     * @return 本地化信息
     */
    public static Locale getLocale() {
        LocaleContext localeContext = LocaleContextHolder.getLocaleContext();
        Locale locale = null;
        if (localeContext != null) {
            locale = localeContext.getLocale();
        }
        if (locale == null) {
            locale = Locale.SIMPLIFIED_CHINESE;
        }
        return locale;
    }

    /**
     * 设置消息源
     *
     * @param messageSource 消息源
     */
    public static void setMessageSource(MessageSource messageSource) {
        synchronized (I18N.class) {
            I18N.messageSource = messageSource;
        }
    }
}
