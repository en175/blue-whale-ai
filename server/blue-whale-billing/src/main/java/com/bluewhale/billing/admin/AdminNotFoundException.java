package com.bluewhale.billing.admin;

/**
 * 管理端操作的**目标不存在**（改/删一条已被别人删掉的折扣）。
 *
 * <p>单独一个类型是为了拿到 404 而不是 400/500：
 * <ul>
 *   <li>400（{@link IllegalArgumentException}）在界面上是「你填的东西不合法」——
 *       运营会回头去改表单，而这次操作的问题不在表单里；</li>
 *   <li>500 是「服务坏了」——运维会去查一个没坏的服务，而真相是两个人同时在操作。</li>
 * </ul>
 *
 * <p>映射见 {@link AdminExceptionHandler}。
 */
public class AdminNotFoundException extends RuntimeException {

    public AdminNotFoundException(String message) {
        super(message);
    }
}
