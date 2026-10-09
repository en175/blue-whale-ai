package com.bluewhale.billing.api;

public class DuplicateGrantKeyException extends RuntimeException {

    private final String existingBizId;

    public DuplicateGrantKeyException(String existingBizId) {
        super("该幂等键已存在：这次操作之前已经成功过，未重复执行");
        this.existingBizId = existingBizId;
    }

    public String existingBizId() {
        return existingBizId;
    }
}
