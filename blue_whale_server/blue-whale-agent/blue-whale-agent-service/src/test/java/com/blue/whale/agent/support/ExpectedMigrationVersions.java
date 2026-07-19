package com.blue.whale.agent.support;

import java.util.List;

/** 迁移版本集期望常量——供 schema 迁移 IT 与验收脚本共享单一事实源。 */
public final class ExpectedMigrationVersions {

    /** 已应用的迁移版本集，有序。加新版本只改此处。 */
    public static final List<Integer> APPLIED = List.of(1, 2, 3, 4, 5, 6);

    /** 记账本字符串形态，派生自 APPLIED（按版本号升序逗号拼接）。 */
    public static final String APPLIED_CSV = String.join(",", APPLIED.stream().map(String::valueOf).toList());

    /**
     * generation 域结构收敛契约所在的迁移版本。
     * 漂移测试期望失败于此文件（V4 承载 generation_jobs 的 fail-closed 全列校验），
     * <b>非版本集派生</b>——加非 generation 域的新版本不会改变此值。
     */
    public static final int GENERATION_CONVERGENCE_VERSION = 4;

    private ExpectedMigrationVersions() {}
}
