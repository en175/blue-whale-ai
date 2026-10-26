# 代码注释规则

本规则是团队编程规范，适用于本仓全部 Agent、源码、测试和工程脚本。

## 编程与审查

1. 禁止新增普通代码注释，包括行内解释、分段说明、TODO、解释性的 JSDoc 和 docstring。修改已有普通注释时删除它，不改写或补充说明。
2. 仅允许编译、检查、构建、运行或代码生成工具实际读取且确有必要的指令，以及必要的许可证声明。`@ts-expect-error`、`eslint-disable` 等属于工具指令；提交说明须记录新增指令的消费者和必要性。指令旁附加的普通解释仍受禁令约束，工具要求的理由除外。
3. 探索代码时，既有注释只提供线索。行为结论必须由实现或测试核验；注释与实现矛盾时，不以注释作为行为证据。
4. SQL 快照只记录本次 DDL，工单号、日期和变更简述记录在工单与提交说明中。

## 自动检查

Git pre-commit 调用 `scripts/check-code-comments.py --staged`，检查实际暂存内容，不读取未暂存修改作为提交证据。脚本按语言识别注释和 Python docstring，与 HEAD 比较；新增或改写的普通注释阻断提交，原样保留或删除的存量注释放行，重命名沿用原文件基线。

TypeScript/JavaScript 使用仓库已有 TypeScript 解析器；其他语言使用固定版本 Pygments 词法库，Python docstring 另由标准库 AST 识别。首次在仓库运行 `python3 scripts/check-code-comments.py --install` 安装隔离的工程依赖；JavaScript/TypeScript 检查还需已有 Node workspace 依赖。缺少解析依赖或检查失败时阻断提交，不静默跳过。

门禁只识别已登记工具指令和许可证格式，不能证明其必要性。审查须逐项核对新增保留项；未识别的必要指令先补充识别及测试，不能关闭门禁。字符串、模板、正则和测试数据中的注释文本不属于代码注释。

手动检查暂存区用 `python3 scripts/check-code-comments.py --staged`；检查提交范围用 `python3 scripts/check-code-comments.py --base <基线提交>`。

## 存量清理

全仓普通注释清理由独立工单 [IKJRH0](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IKJRH0) 承接。普通任务保持改动范围，不附带全仓清理。清理须核验工具指令、许可证和运行时消费者，保持代码及工具行为。
