package com.blue.whale.web;

import com.blue.whale.global.i18n.I18NPropertiesLoader;
import org.springframework.lang.NonNull;

import java.util.Set;

/**
 * WebI18NLoader
 *
 * @author: Jiyeon2__
 * date: 2024/8/16
 * description:
 */
public class WebI18NLoader implements I18NPropertiesLoader {
    @Override
    @NonNull
    public Set<String> paths() {
        return Set.of("i18n/web");
    }
}

