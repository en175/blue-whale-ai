package com.blue.whale.security.model;

import com.blue.whale.global.i18n.I18NPropertiesLoader;
import org.springframework.lang.NonNull;

import java.util.Set;

/**
 * SecurityModelI18NLoader
 *
 * @author: Jiyeon2__
 * date: 2024/8/14
 * description:
 */
public class SecurityModelI18NLoader implements I18NPropertiesLoader {

    @Override
    @NonNull
    public Set<String> paths() {
        return Set.of("i18n/security");
    }
}
