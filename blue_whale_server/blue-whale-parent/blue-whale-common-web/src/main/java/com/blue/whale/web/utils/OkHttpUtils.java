package com.blue.whale.web.utils;


import cn.hutool.core.collection.CollUtil;
import com.alibaba.fastjson2.JSON;
import lombok.extern.slf4j.Slf4j;
import okhttp3.*;

import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * OkHttpUtils
 *
 * @author: Jiyeon2__
 * date: 2025/4/24
 * description:
 */
@Slf4j
public class OkHttpUtils {

    public static String get(String queryUrl, Map<String, String> headers, Map<String, String> params, int retryCount) {
        try {
            OkHttpClient client = new OkHttpClient().newBuilder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .build();
            HttpUrl.Builder urlBuilder = Objects.requireNonNull(HttpUrl.parse(queryUrl))
                    .newBuilder();
            Headers.Builder headerBuild = new Headers.Builder();
            if (Objects.nonNull(headers)) {
                headers.forEach(headerBuild::add);
            }
            if (Objects.nonNull(params)) {
                params.forEach(urlBuilder::addQueryParameter);
            }
            HttpUrl url = urlBuilder.build();
            Request request = new Request.Builder()
                    .url(url)
                    .get()
                    .headers(headerBuild.build())
                    .build();
            return Objects.requireNonNull(client.newCall(request)
                            .execute()
                            .body())
                    .string();
        } catch (Exception e) {
            log.error("okhttp get system error url = {} headers = {} params = {} msg = {}", queryUrl, JSON.toJSONString(headers), JSON.toJSONString(params), e.getMessage(), e);
        }

        if (retryCount > 0) {
            return get(queryUrl, headers, params, retryCount - 1);
        }
        return "";
    }

    public static String postBody(String queryUrl, Map<String, String> headers, String body, int retryCount) {
        try {
            OkHttpClient client = new OkHttpClient().newBuilder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .build();
            Headers.Builder headerBuild = new Headers.Builder();
            if (Objects.nonNull(headers)) {
                headers.forEach(headerBuild::add);
            }
            RequestBody requestBody = RequestBody.create(body, MediaType.parse("application/json"));
            Request request = new Request.Builder()
                    .url(queryUrl)
                    .post(requestBody)
                    .headers(headerBuild.build())
                    .build();
            return Objects.requireNonNull(client.newCall(request)
                            .execute()
                            .body())
                    .string();
        } catch (Exception e) {
            log.error("okhttp post system error url = {} headers = {} params = {} msg = {}", queryUrl, JSON.toJSONString(headers), body, e.getMessage(), e);
        }

        if (retryCount > 0) {
            return postBody(queryUrl, headers, body, retryCount - 1);
        }

        return "";
    }


    public static String postForm(String queryUrl, Map<String, String> headers, Map<String, String> params, int retryCount) {
        try {
            OkHttpClient client = new OkHttpClient().newBuilder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .build();
            Headers.Builder headerBuild = new Headers.Builder();
            if (Objects.nonNull(headers)) {
                headers.forEach(headerBuild::add);
            }
            FormBody.Builder formBodyBuilder = new FormBody.Builder();
            if (CollUtil.isNotEmpty(params)) {
                params.forEach(formBodyBuilder::add);
            }

            Request request = new Request.Builder()
                    .url(queryUrl)
                    .post(formBodyBuilder.build())
                    .headers(headerBuild.build())
                    .build();
            return Objects.requireNonNull(client.newCall(request)
                            .execute()
                            .body())
                    .string();
        } catch (Exception e) {
            log.error("okhttp post system error url = {} headers = {} params = {} msg = {}", queryUrl, JSON.toJSONString(headers), JSON.toJSONString(params), e.getMessage(), e);
        }

        if (retryCount > 0) {
            return postForm(queryUrl, headers, params, retryCount - 1);
        }

        return "";
    }
}
