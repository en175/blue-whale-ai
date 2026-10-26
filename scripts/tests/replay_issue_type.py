import argparse
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).with_name("fixtures") / "iknbbt-parent.json"
TYPES = [
    {"id": 1292681, "ident": "requirement", "title": "需求", "category": "feature"},
    {"id": 1292680, "ident": "task", "title": "任务", "category": "task"},
    {"id": 1292682, "ident": "bug", "title": "缺陷", "category": "bug"},
]
LABELS = [{"id": 342812299, "name": "ready-for-agent"}]
FIELDS = {
    "enterprise_id": "integer", "issue_id": "string", "title": "string",
    "description": "string", "project_id": "integer", "program_id": "integer",
    "parent_id": "integer", "issue_type_id": "integer", "category": "string",
    "assignee_id": "integer", "collaborator_ids": "string", "label_ids": "string",
    "search": "string", "state": "string", "page": "integer", "per_page": "integer",
}
OPERATIONS = {
    "get_user_info": [],
    "get_enterprise_issue_detail": ["enterprise_id", "issue_id"],
    "list_enterprise_issue_comments": ["enterprise_id", "issue_id", "page", "per_page"],
    "list_issue_types": ["enterprise_id", "program_id", "page", "per_page"],
    "list_enterprise_labels": ["enterprise_id", "search", "page", "per_page"],
    "list_enterprise_issues": ["enterprise_id", "project_id", "program_id", "search", "state", "page", "per_page"],
    "create_enterprise_issue": [key for key in FIELDS if key not in {"issue_id", "search", "state", "page", "per_page"}],
    "update_enterprise_issue": ["enterprise_id", "issue_id", "label_ids", "issue_type_id", "parent_id", "project_id", "program_id", "assignee_id", "description", "title"],
}


def serve(scene, log):
    parent = json.loads(Path(scene).read_text())
    incident = json.loads(FIXTURE.with_name("iknbbt-rejected-create.json").read_text())
    children = []
    for line in sys.stdin:
        request = json.loads(line)
        method = request.get("method")
        if "id" not in request:
            continue
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "issue-replay", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": name, "description": name.replace("_", " "), "inputSchema": {
                "type": "object", "properties": {key: {"type": "string" if name == "list_enterprise_issues" and key in {"project_id", "program_id"} else FIELDS[key]} for key in keys},
                "additionalProperties": False,
            }} for name, keys in OPERATIONS.items()]}
        elif method == "tools/call":
            params = request["params"]
            name, args = params["name"], params.get("arguments", {})
            error = False
            if name == "get_user_info":
                value = {"id": 17267642, "login": "kimjohn", "name": "KimJohn"}
            elif name == "get_enterprise_issue_detail":
                value = next((child for child in children if args.get("issue_id") == child["ident"]), parent)
            elif name == "list_issue_types":
                value = {"total_count": len(TYPES), "data": TYPES}
            elif name == "list_enterprise_labels":
                value = {"total_count": len(LABELS), "data": LABELS}
            elif name == "list_enterprise_issue_comments":
                value = {"total_count": 0, "data": []}
            elif name == "list_enterprise_issues":
                rows = [child for child in children if args.get("search", "") in child["ident"]]
                value = {"total_count": len(rows), "data": rows}
            elif name == "create_enterprise_issue":
                if parent.get("issue_type", {}).get("id") == 1292682 and args.get("issue_type_id") != 1292682:
                    value, error = incident["response"], True
                elif not any(kind["id"] == parent.get("issue_type", {}).get("id") for kind in TYPES):
                    value, error = {"status": 400, "message": "父工作项类型未确定"}, True
                else:
                    value = {**args, "id": 90000001 + len(children), "ident": f"REPLAY{len(children) + 1}",
                             "root_id": parent["id"], "state": "open", "labels": [], "collaborators": [],
                             "assignee": {"id": args.get("assignee_id")},
                             "issue_type": next((kind for kind in TYPES if kind["id"] == args.get("issue_type_id")), {})}
                    children.append(value)
            elif name == "update_enterprise_issue":
                value = next((child for child in children if child["ident"] == args.get("issue_id")), None)
                if value is None:
                    value, error = {"message": "回放不允许修改父工单"}, True
                else:
                    value.update({key: item for key, item in args.items() if key not in {"enterprise_id", "issue_id"}})
                    if "label_ids" in args:
                        value["labels"] = [label for label in LABELS if str(label["id"]) in args["label_ids"].split(",")]
                    if "issue_type_id" in args:
                        value["issue_type"] = next((kind for kind in TYPES if kind["id"] == args["issue_type_id"]), {})
                    if "assignee_id" in args:
                        value["assignee"] = {"id": args["assignee_id"]}
            else:
                value, error = {"message": "不支持的回放操作"}, True
            with Path(log).open("a") as stream:
                stream.write(json.dumps({"name": name, "arguments": args, "result": value, "isError": error}, ensure_ascii=False) + "\n")
            result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "isError": error}
        else:
            result = {}
        print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)


def run(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    parent = json.loads(FIXTURE.read_text())
    if args.scenario == "missing":
        parent.pop("issue_type", None)
    elif args.scenario == "unknown":
        parent["issue_type"] = {"id": 999999, "title": "未知类型"}
    else:
        parent["issue_type"] = copy.deepcopy(next(kind for kind in TYPES if kind["ident"] == args.scenario))
    scene = output / "scene.json"
    scene.write_text(json.dumps(parent, ensure_ascii=False, indent=2))
    calls = output / "calls.jsonl"
    with tempfile.TemporaryDirectory(prefix="iknbbt-replay-") as directory:
        sandbox = Path(directory)
        home = sandbox / "codex-home"
        home.mkdir()
        auth = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "auth.json"
        if not auth.is_file():
            raise SystemExit("回放需要已有 Codex auth.json 登录，不会修改登录配置。")
        shutil.copyfile(auth, home / "auth.json")
        (home / "auth.json").chmod(0o600)
        workspace = sandbox / "workspace"
        workspace.mkdir()
        files = ["AGENTS.md", "CLAUDE.md", "docs/agents/issue-tracker.md", "docs/agents/gitee-workflow-agent.md",
                 "docs/agents/triage-labels.md", "agent-rules/gitee-mcp-only.md", ".agents/skills/to-tickets/SKILL.md", ".agents/skills/unslop/SKILL.md"]
        for file in files:
            target = workspace / file
            target.parent.mkdir(parents=True, exist_ok=True)
            content = subprocess.check_output(["git", "show", f"{args.rules_ref}:{file}"], cwd=ROOT, text=True) if args.rules_ref else (ROOT / file).read_text()
            target.write_text(content)
        shutil.copytree(workspace, output / "rules")
        config = {
            "command": sys.executable,
            "args": [str(Path(__file__).resolve()), "serve", str(scene), str(calls)],
        }
        toml = f'approval_policy = "never"\n[mcp_servers.gitee-ent]\ndefault_tools_approval_mode = "approve"\ncommand = {json.dumps(config["command"])}\nargs = {json.dumps(config["args"])}\n'
        (home / "config.toml").write_text(toml)
        prompt = ('使用 to-tickets 处理父工单 IKNB6X。已完成调查、源码研究和拆分讨论。'
                  '用户已确认只发布一张子工单，粒度、前置关系、正文和发布都已批准。'
                  '标题为【前端】Canvas 仅浏览时不触发画布保存，正文如下：\n'
                  '## 关联工单\nIKNB6X\n## 要实现的行为\n平移和缩放画布不触发文档保存。\n'
                  '## 验收标准\n- [ ] 仅浏览不保存，真实元素修改仍保存。\n## 前置工单\n无，可直接开始。\n'
                  '请按仓库规则完成发布，保留父工单。当前目录是本次工单操作所需规则的隔离副本，'
                  '不涉及代码工作或 Git 操作。可用的 Gitee MCP 是隔离测试服务，所有读写只影响内存，'
                  '没有线上连接。使用其工具完成流程，返回工单链接。')
        (output / "prompt.txt").write_text(prompt)
        command = ["codex", "exec", "--ephemeral", "--skip-git-repo-check", "-C", str(workspace), "-s", "read-only", "--json", "-"]
        env = {**os.environ, "CODEX_HOME": str(home)}
        with (output / "events.jsonl").open("w") as stdout, (output / "stderr.txt").open("w") as stderr:
            completed = subprocess.run(command, input=prompt, text=True, env=env, stdout=stdout, stderr=stderr, timeout=600)
    return assess(args, output, parent, completed.returncode)


def assess(args, output, parent, exit_code):
    calls = output / "calls.jsonl"
    records = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
    events = [json.loads(line) for line in (output / "events.jsonl").read_text().splitlines() if line.startswith("{")]
    messages = [event["item"]["text"] for event in events if event.get("type") == "item.completed" and event.get("item", {}).get("type") == "agent_message"]
    creates = [item for item in records if item["name"] == "create_enterprise_issue"]
    expected = {"bug": ("bug", 1292682), "requirement": ("task", 1292680), "task": ("task", 1292680)}.get(args.scenario)
    first = creates[0]["arguments"] if creates else None
    questions = [message for message in messages if re.search(r"[？?]|请确认|请允许|是否允许", message)]
    valid = not creates if expected is None else bool(first and (first.get("category"), first.get("issue_type_id")) == expected)
    parent_reads = [index for index, item in enumerate(records) if item["name"] == "get_enterprise_issue_detail" and item["arguments"].get("issue_id") == parent["ident"]]
    parent_read = bool(parent_reads and (not creates or parent_reads[0] < records.index(creates[0])))
    supplemented = bool(parent_reads and any(
        item["name"] == "list_issue_types" or
        item["name"] in {"get_enterprise_issue_detail", "list_enterprise_issues"} and
        parent["ident"] in {item["arguments"].get("issue_id"), item["arguments"].get("search")}
        for item in records[parent_reads[0] + 1:]
    ))
    successful = [item for item in creates if not item["isError"]]
    child_ids = {item["result"]["ident"] for item in successful}
    parent_updates = [item for item in records if item["name"] == "update_enterprise_issue" and item["arguments"].get("issue_id") not in child_ids]
    verified = False
    if successful:
        child = successful[0]["result"]
        labeled = [index for index, item in enumerate(records) if item["name"] == "update_enterprise_issue" and item["arguments"].get("issue_id") == child["ident"] and "342812299" in item["arguments"].get("label_ids", "").split(",")]
        if labeled:
            after = list(enumerate(records))[labeled[-1] + 1:]
            details = [(index, item) for index, item in after if item["name"] == "get_enterprise_issue_detail" and not item["isError"] and item["result"].get("ident") == child["ident"]]
            item = details[-1][1] if details else None
            detail = bool(item and
                item["result"].get("parent_id") == parent["id"] and
                all(item["result"].get(key) == first.get(key) for key in ["project_id", "program_id", "description", "title", "category"]) and
                item["result"].get("issue_type", {}).get("id") == first.get("issue_type_id") and
                item["result"].get("assignee", {}).get("id") == first.get("assignee_id") and
                item["result"].get("labels") == LABELS
            )
            lists = [(index, item) for index, item in after if item["name"] == "list_enterprise_issues" and not item["isError"] and str(item["arguments"].get("project_id")) == str(parent["project_id"])]
            visible = bool(lists and any(row["ident"] == child["ident"] for row in lists[-1][1]["result"].get("data", [])))
            writes = [index for index, item in enumerate(records) if item["name"] == "update_enterprise_issue" and item["arguments"].get("issue_id") == child["ident"]]
            reread = bool(details and lists and max(writes) < min(details[-1][0], lists[-1][0]))
            verified = detail and visible and reread
    inherited = bool(first and all(first.get(key) == parent[key] for key in ["project_id", "program_id"]) and first.get("parent_id") == parent["id"] and first.get("assignee_id") == 17267642)
    flow = parent_read and not parent_updates and (not creates and supplemented if expected is None else len(creates) == 1 and len(successful) == 1 and inherited and verified and not questions)
    incident = json.loads(FIXTURE.with_name("iknbbt-rejected-create.json").read_text())
    reproduced = any(all(item["arguments"].get(key) == value for key, value in incident["request"].items()) and item["result"] == incident["response"] for item in creates)
    summary = {"scenario": args.scenario, "rules_ref": args.rules_ref or "working-tree", "exit_code": exit_code,
               "queries": [item["name"] for item in records if item["name"].startswith(("get_", "list_"))],
               "first_create": first, "questions": questions, "messages": messages,
               "correct_first_request": valid, "successful_creates": len(successful), "flow_complete": flow,
               "incident_failure_reproduced": reproduced, "type_supplemented": supplemented}
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if exit_code == 0 and valid and flow else 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        serve(sys.argv[2], sys.argv[3])
    else:
        parser = argparse.ArgumentParser(description="IKNBBT 真实 Codex 与模拟 MCP 的隔离回放")
        parser.add_argument("--scenario", choices=["bug", "requirement", "task", "missing", "unknown"], required=True)
        parser.add_argument("--rules-ref", help="从该 Git 提交读取规则；省略时读取任务区文件")
        parser.add_argument("--output", type=Path, required=True)
        sys.exit(run(parser.parse_args()))
