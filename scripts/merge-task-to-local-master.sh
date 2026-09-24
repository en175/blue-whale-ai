#!/usr/bin/env bash
# Legacy entrypoint. Daily task branches merge into the recorded release through PR.
cat >&2 <<'MESSAGE'
❌ merge-task-to-local-master 已废止：本地 master 只代表生产版本，任务不得在这里提前集成。
请从当前发布线建立任务区，验证后向任务元数据记录的 release 提 PR。
紧急生产 hotfix 另需负责人授权，不使用本入口。
MESSAGE
exit 1
