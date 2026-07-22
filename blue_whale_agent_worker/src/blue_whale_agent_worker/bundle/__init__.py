"""Runtime Agent Bundle 拉取与校验（契约 §3.3 / §6）。

本子包承接 IK2QBI 范围：Worker 按 AgentRun pin 拉取发布快照、本地重算
manifestDigest 并与 Run pin 逐字节比对，任何 pin 不符、快照缺失或摘要不一致都
fail closed，错误以规范化错误码提交给 Java，绝不回退默认提示词或 Mock。

子模块职责：``loader`` 装载基础上下文并过 token 预算门（IK2QBJ），``gate`` 承接 on_demand
受限 ``read_resource`` 与 checkpoint 已读账本恢复（IK2QBM / IK2QBQ），``cache`` 提供本地内容
寻址缓存（IK2QBP），``tokens`` 统一 ``chars_div_4`` token 估算公式（对齐 Java 发布侧）。
"""
