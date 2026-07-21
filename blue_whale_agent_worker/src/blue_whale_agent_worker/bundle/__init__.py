"""Runtime Agent Bundle 拉取与校验（契约 §3.3 / §6）。

本子包承接 IK2QBI 范围：Worker 按 AgentRun pin 拉取发布快照、本地重算
manifestDigest 并与 Run pin 逐字节比对，任何 pin 不符、快照缺失或摘要不一致都
fail closed，错误以规范化错误码提交给 Java，绝不回退默认提示词或 Mock。

渐进装载、token 预算门、本地内容寻址缓存与 checkpoint 恢复由 sibling 子任务
（IK2QBJ / IK2QBM / IK2QBP / IK2QBQ）承接，不在本子包范围内。
"""
