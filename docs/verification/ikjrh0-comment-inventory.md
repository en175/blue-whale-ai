# IKJRH0 清理范围与保留清单

本轮修订以 `3e689cf6fc77edff58573fb137349024ebcecfa2` 为起点，补清复审发现的全仓维护范围遗漏。清理按 TypeScript AST、Pygments 2.19.2 词法 token 及 Python AST 盘点。字符串、模板、正则和测试数据不作为代码注释删除。

## 范围

发布线随后同步至 `8c43ea43fc372ce086c5f1807576d7e882578784`。三个 lint 冲突保留该发布线的执行代码并重放注释清理，语法树与编译输出一致。机器清单在同步后重新生成，源码快照为 `b21e3ef7a76a75c0974c4c0ac9d0770fe00df284`。

同步后盘点 3364 个跟踪文件，其中 2592 个属于已识别代码语言。Markdown、JSON、图片和其他资料分别识别为文档、数据或静态资产。逐语言数量及逐文件保留项见 [机器清单](ikjrh0-comment-inventory.json)。清理文件清单以 Git diff 为准。

本轮修改 470 个维护文件，删除 7147 个普通注释 token。包括两个 Web 测试、405 个 Java 文件、两个 YAML 文件、11 个 XML 文件、四个 properties 文件、两个 Dockerfile、42 个未受 checksum 或逐字对账约束的 SQL 文件、Prisma 普通行说明及一个 Hook 普通说明。

## 保留依据

| 内容 | 消费者与必要性 |
| --- | --- |
| shebang、编码声明、检查指令、许可证 | 解释器、TypeScript、Vitest、ShellCheck 等直接消费；逐文件行号见机器清单。 |
| 七个 Python 模块 docstring | `argparse.ArgumentParser(description=__doc__)` 用于实际 `--help` 输出。 |
| `AccountCredits/data.ts` 两个占位哨兵 | `data.test.ts` 读取源码并断言标记；沿用存量计数，不设置通用 TODO 豁免。 |
| Hook 审计标记 | `check-hook-contracts.py` 要求运行时 Gate 源文同时包含共享审计器路径与操作参数，实际 Python 实现调用该审计器。 |
| Prisma 的 `///` 文档 | Prisma client 生成器读取 API 文档元数据；普通 `//` 说明已清理，schema 校验通过。 |
| 五个 proto 的 API 文档 | `buf.gen.yaml` 的 protoc-gen-es 生成 SDK 文件文档与类型 JSDoc；现有生成物中可核对来源。计费对账另读取维度与错误语义原文。 |
| 已应用 Prisma／Flyway migration | 历史迁移 checksum 依赖文件字节，原样保留。 |
| 与 migration 逐字相等的 SQL 副本 | 三轨测试直接比较全文。机器清单列出对应 migration，避免将整棵 SQL 目录豁免。其余 SQL 普通说明已清理。 |
| `schema/011_e_layer_decimal_duration.sql` 的前置查询 token | `e-layer-parity.test.ts` 直接断言回填候选查询原文。删除时已复现失败，保留该 token 后对应测试通过。 |
| `VocalSplitError.java` 的契约链接 token | `vocal-split.test.ts` 直接断言 `@link` 原文。删除时已复现失败，保留该 token 后对应测试通过。其余 Java 普通注释已清理。 |
| 文档与原型 HTML | 属于说明与设计资产，按工单范围分别识别。字符串、模板、正则、测试数据及不可手工修改的生成物不清理。 |

## 等价检查与验证边界

两个 Web 文件删除 118 个普通说明 token 后，TypeScript 去注释编译输出与实际 Vitest hoist 转换的执行输出一致，71 个用例通过。468 个非 JS 修改文件的非注释 token 一致，包含字符串内空白；XML 的元素、属性和 SQL token 一致。两个 YAML 文件经 SnakeYAML 2.2 解析的值一致，Prisma schema 校验通过。

本轮首次源码消费者测试为 1370 个通过、两个失败、163 个环境条件跳过。两项失败分别定位到上述 SQL 查询和 Java 契约链接；保留原文后在任务工作树运行相关测试，21 个用例通过。完整验证以修订 HEAD 的选择器凭证为准，跳过不计为真库或浏览器通过。

Pygments 对 Prisma 及两个 Java 文件的个别既有语法 token 有解析缺口，本轮不将词法结果冒称完整语法证明。Prisma 使用实际校验器补查；Java 由 Maven 编译与测试补查。CBM 查询返回 `Transport closed`，结构定位与消费者结论使用固定起点源码及实际复现。

## Java 测试夹具

`server/blue-whale-worker/src/test/resources/db/bluewhale-schema.sql` 是已有 MySQL 测试夹具，本轮只删除注释，DDL token 不变。其模型来源为 `backend/prisma/schema.prisma`，历史追加表及列以对应 migration 为准。更新夹具属于后续模型变更，不由本轮清理重建或执行迁移。
