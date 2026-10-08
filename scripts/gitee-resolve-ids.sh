#!/usr/bin/env bash

set -euo pipefail

fail() { echo "❌ gitee-resolve-ids: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法：
  gitee-resolve-ids.sh resolve  <PR_URL | ISSUE_URL | path-with-namespace>
  gitee-resolve-ids.sh check-id <enterprise_id|project_id> <值>
  gitee-resolve-ids.sh diagnose-401

resolve 示例：
  gitee-resolve-ids.sh resolve "https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/repos/hangzhou-xuanfu_1/blue-whale-ai/pulls/93"
  gitee-resolve-ids.sh resolve "hangzhou-xuanfu_1/blue-whale-ai"
  gitee-resolve-ids.sh resolve "https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/pulls/93"

check-id 示例：
  gitee-resolve-ids.sh check-id enterprise_id 883843
  gitee-resolve-ids.sh check-id project_id 12345678
EOF
}

do_resolve() {
  local input="$1"
  local enterprise_path="" repo_path="" res_kind="" res_number="" url_route_id=""

  local stripped="${input#*://}"
  stripped="${stripped#*gitee.com/}"
  stripped="${stripped#*e.gitee.com/}"
  stripped="${stripped#/}"

  if [[ "$stripped" =~ ^([^/]+)/projects/([0-9]+)/repos/([^/]+)/([^/]+)/(.*)$ ]]; then
    enterprise_path="${BASH_REMATCH[1]}"
    url_route_id="${BASH_REMATCH[2]}"
    repo_path="${BASH_REMATCH[3]}/${BASH_REMATCH[4]}"
    local tail="${BASH_REMATCH[5]}"
    case "$tail" in
      pulls/*)   res_kind="pull";  res_number="${tail#pulls/}"   ;;
      issues/*)  res_kind="issue"; res_number="${tail#issues/}"  ;;
    esac
  elif [[ "$stripped" =~ ^([^/]+)/([^/]+)/(pulls|issues)/([A-Za-z0-9]+) ]]; then
    enterprise_path="${BASH_REMATCH[1]}"
    repo_path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    [[ "${BASH_REMATCH[3]}" == "pulls" ]] && res_kind="pull" || res_kind="issue"
    res_number="${BASH_REMATCH[4]}"
  elif [[ "$stripped" =~ ^([^/]+)/([^/]+)$ ]]; then
    enterprise_path="${BASH_REMATCH[1]}"
    repo_path="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    fail "无法解析输入：$input
预期形式之一：
  - 企业版 URL：https://e.gitee.com/{org}/projects/{NNNN}/repos/{org}/{repo}/pulls/{n}
  - 普通版 URL：https://gitee.com/{org}/{repo}/pulls/{n}
  - 裸 path：{org}/{repo}"
  fi

  [[ -n "$enterprise_path" ]] || fail "未能抽出企业 path。"
  [[ -n "$repo_path" ]] || fail "未能抽出仓库 path-with-namespace。"

  echo "解析结果："
  echo "  输入                  : $input"
  echo "  企业 path            : $enterprise_path"
  echo "  仓库 path-with-ns    : $repo_path"
  if [[ -n "$res_kind" ]]; then
    echo "  资源                  : ${res_kind} #${res_number}"
  fi
  echo ""
  echo "── 可直接执行的 MCP 查询（动态解析 API ID） ──"
  echo "  enterprise_id = list_enterprises()  → 取 path=\"$enterprise_path\" 的 id"
  echo "  project_id    = list_enterprise_repositories(enterprise_id, search=\"$(basename "$repo_path")\")"
  echo "                   → 取 path_with_namespace=\"$repo_path\" 的 id"
  echo ""
  if [[ -n "$res_kind" ]]; then
    echo "── 可直接调用的 MCP 工具（填入上面查到的两个 id） ──"
    if [[ "$res_kind" == "pull" ]]; then
      echo "  get_enterprise_pull_detail(enterprise_id=<上查>, project_id=<上查>, pull_request_id=$res_number)"
      echo "  comment_enterprise_pull(enterprise_id=<上查>, project_id=<上查>, pull_request_id=$res_number, body=\"...\")"
    else
      echo "  get_enterprise_issue_detail(enterprise_id=<上查>, issue_id=\"$res_number\")"
      echo "  comment_enterprise_issue(enterprise_id=<上查>, issue_id=\"$res_number\", body=\"...\")"
    fi
    echo ""
    echo "  注：pull_request_id / issue 编号是 URL 里【唯一可直接抄】的数字。"
  fi

  if [[ -n "$url_route_id" ]]; then
    echo ""
    echo "⚠️  URL 中 projects/$url_route_id 的 $url_route_id 是网页路由 ID。"
    echo "   它【不是】enterprise_id，也【不是】project_id——切勿直接传给任何 mcp__gitee-ent__* 工具。"
    echo "   （误传会触发 401「企业未授权此应用进行访问」，实为 ID 指向的企业不存在，非授权问题）"
  fi
}

KNOWN_URL_ROUTE_IDS=(
  "883843"
)

do_check_id() {
  local which="$1" value="$2"
  [[ "$which" == "enterprise_id" || "$which" == "project_id" ]] \
    || fail "第一个参数必须是 enterprise_id 或 project_id，收到：$which"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "$which 的值应为纯数字，收到：$value"

  echo "校验：$which = $value"
  echo ""

  local is_known_route=0
  for bad in "${KNOWN_URL_ROUTE_IDS[@]}"; do
    [[ "$value" == "$bad" ]] && { is_known_route=1; break; }
  done
  if [[ "$is_known_route" == 1 ]]; then
    echo "🚨 已知危险：$value 在本仓 URL 路由 ID 清单中（e.gitee.com projects/ 段网页路由 ID）。"
    echo "   它【不是】enterprise_id 也【不是】project_id。传给任何 mcp__gitee-ent__* 工具"
    echo "   会触发误导性 401「企业未授权此应用进行访问」（实为企业不存在，非授权问题）。"
    echo ""
    echo "   → 用下面的动态查询换掉它。"
  else
    echo "ⓘ 无法离线确认 ${value} 是否为正确的 ${which}。"
    echo "   日常值见 CLAUDE.md；疑似变更时用下面的动态查询核对。"
  fi
  echo ""

  if [[ "$which" == "enterprise_id" ]]; then
    echo "需核对时：list_enterprises() → 取 path==\"hangzhou-xuanfu_1\" 的 id。"
    echo "  enterprise_id 不出现在任何网页 URL 中。"
  else
    echo "需核对时：list_enterprise_repositories(enterprise_id, search=\"blue-whale-ai\")"
    echo "            → 取 path_with_namespace==\"hangzhou-xuanfu_1/blue-whale-ai\" 的 id。"
    echo "  project_id 不出现在任何网页 URL 中。"
  fi
  echo ""
  echo "  401 自检：调 get_user_info()"
  echo "    - 成功 → token 有效；核对 ${which}，不一致时改用查询所得 ID。"
  echo "    - 401  → 排查 token 失效或类型不符。"
}

do_diagnose_401() {
  cat <<'EOF'
401「企业未授权此应用进行访问」诊断决策树
==========================================

Gitee 这条信息把三种性质不同的情况混为一谈，按下面顺序排查：

步骤 1：判 token 是否有效
  调 get_user_info()
    ├─ 成功返回用户 → token 有效，进入步骤 2
    └─ 401          → token 失效或类型不符，进入步骤 3

步骤 2：token 有效时核对 ID
  调 list_enterprises() 核对 enterprise_id，调 list_enterprise_repositories() 核对 project_id。
  若与请求值不同，改用查询所得 ID；常见错误是把网页 URL projects/ 后的数字当成 enterprise_id。
  若 ID 一致，继续核对目标资源和访问权限。
  gitee-resolve-ids.sh resolve <URL> 可给出查询指引。

步骤 3：token 无效或类型不符
  - 普通版 REST（/api/v5）报「Access token is wrong type」
    → 该 token 是企业版 MCP 专用，不能调普通 API；用 MCP 工具而非 curl。
  - MCP 工具也 401
    → token 过期或被吊销，重新生成。

本仓日常 ID 见 CLAUDE.md；遇 401 或疑似变更时动态核对，不从网页 URL 抄 enterprise_id / project_id。
EOF
}

[[ $# -ge 1 ]] || { usage; exit 1; }
cmd="$1"; shift
case "$cmd" in
  resolve)       [[ $# -eq 1 ]] || { usage; exit 1; }; do_resolve "$1" ;;
  check-id)      [[ $# -eq 2 ]] || { usage; exit 1; }; do_check_id "$1" "$2" ;;
  diagnose-401)  do_diagnose_401 ;;
  -h|--help|help) usage ;;
  *) fail "未知命令：$cmd（应为 resolve | check-id | diagnose-401）" ;;
esac
