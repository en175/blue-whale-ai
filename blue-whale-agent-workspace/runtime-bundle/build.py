#!/usr/bin/env python3
"""首版 Runtime Agent Bundle 构建与静态校验（IK2D8R）。

从 ``bundle-source.json`` + ``resources/`` 组装与 Java 控制面导出/导入兼容的便携包
``dist/first-runtime-bundle.json``：

- 计算每个资源的 contentDigest / sizeBytes / tokenEstimate（chars_div_4：空串 0，
  否则 ``max(1, (len + 3) // 4)``，与 Java ``RuntimeBundleValidator`` 逐字节一致）。
- 静态校验：资源形状、引用闭包与环、conflictDomain 唯一、Role / 根 RuntimeSkill
  唯一、always_on 仅限 Role/Rule、token 预算三门（含 Worker 装载器更严格的初始
  上下文口径：Skill 元数据 + 已解析引用 resourceId + 根 Skill resourceId）。
- manifestDigest 复用 worker ``bundle/canonical.py``（与 Java
  ``RuntimeBundleDigests`` 逐字节对齐的参考实现），避免第三份实现漂移。

用法::

    python3 build.py          # 构建并写入 dist/first-runtime-bundle.json
    python3 build.py --check  # 只校验并比对 dist 是否最新（不写入，差异时退出码 1）

``dist/`` 是本地生成物（``.gitignore`` 忽略，不入库）；自动化测试各自重建包，
干净 clone 上无需先手工构建。仅依赖 Python 标准库（3.10+）。
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any

BUNDLE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BUNDLE_DIR.parent.parent
SOURCE_PATH = BUNDLE_DIR / "bundle-source.json"
DIST_PATH = BUNDLE_DIR / "dist" / "first-runtime-bundle.json"

# 与 Java 逐字节对齐的规范化摘要与 token 估算参考实现（worker 侧）。
# 按文件路径加载，不经过 worker 包 __init__，保持本脚本零三方依赖。
_WORKER_BUNDLE_DIR = (
    REPO_ROOT / "blue_whale_agent_worker" / "src" / "blue_whale_agent_worker" / "bundle"
)


def _load_worker_module(name: str):
    spec = importlib.util.spec_from_file_location(
        f"bw_bundle_{name}", _WORKER_BUNDLE_DIR / f"{name}.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


manifest_digest = _load_worker_module("canonical").manifest_digest
estimate_tokens = _load_worker_module("tokens").estimate_chars_div_4

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]{2,79}$")
SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
RESOURCE_PATH = re.compile(
    r"^(?!/)(?!.*\\)(?!.*(?:^|/)\.{1,2}(?:/|$))(?!.*//)"
    r"[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$"
)
CONFLICT_DOMAIN = re.compile(r"^[a-z][a-z0-9_.:-]*$")
RAW_REF = re.compile(r"^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!/).+$")
SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
RESOURCE_KINDS = {"role_document", "rule", "runtime_skill", "reference"}
SUPPORTED_ESTIMATOR = "chars_div_4"


class BuildError(Exception):
    """静态校验失败的汇总（args[0] 为错误列表）。"""


def content_digest(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _resolve_ref(from_path: str, raw_ref: str) -> str:
    """按 RFC 3986 相对引用语义解析 rawRef（基于 from_path 所在目录）。"""
    base = Path(from_path).parent
    resolved = (base / raw_ref).as_posix()
    parts: list[str] = []
    for segment in resolved.split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            if not parts:
                return ""
            parts.pop()
        else:
            parts.append(segment)
    return "/".join(parts)


def _load_resource_bodies(
    source: dict[str, Any], errors: list[str]
) -> dict[str, str]:
    bodies: dict[str, str] = {}
    for resource in source["resources"]:
        resource_id = resource.get("resource_id", "?")
        path = resource.get("path", "")
        file_path = BUNDLE_DIR / "resources" / path
        try:
            raw_bytes = file_path.read_bytes()
        except OSError:
            errors.append(f"missing_resource_file:{resource_id}:{path}")
            continue
        if raw_bytes.startswith(b"\xef\xbb\xbf"):
            errors.append(f"invalid_resource_encoding:{resource_id}:bom")
            continue
        try:
            text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            errors.append(f"invalid_resource_encoding:{resource_id}:utf8")
            continue
        if "\r" in text:
            errors.append(f"invalid_resource_encoding:{resource_id}:crlf")
            continue
        bodies[resource_id] = text
    return bodies


def _validate_resource_shapes(source: dict[str, Any], errors: list[str]) -> None:
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    for resource in source["resources"]:
        resource_id = resource.get("resource_id", "")
        if not IDENTIFIER.match(resource_id):
            errors.append(f"invalid_resource_id:{resource_id}")
        if resource_id in seen_ids:
            errors.append(f"duplicate_resource_id:{resource_id}")
        seen_ids.add(resource_id)
        path = resource.get("path", "")
        if not RESOURCE_PATH.match(path):
            errors.append(f"invalid_resource_path:{resource_id}:{path}")
        if path in seen_paths:
            errors.append(f"duplicate_resource_path:{path}")
        seen_paths.add(path)
        kind = resource.get("kind", "")
        if kind not in RESOURCE_KINDS:
            errors.append(f"invalid_resource_kind:{resource_id}:{kind}")
        revision = resource.get("revision")
        if not isinstance(revision, int) or revision < 1:
            errors.append(f"invalid_resource_revision:{resource_id}")
        if resource.get("media_type") != "text/markdown":
            errors.append(f"invalid_media_type:{resource_id}")
        load_mode = resource.get("load_mode", "")
        allowed = (
            load_mode == "always_on"
            if kind == "role_document"
            else load_mode == "on_demand"
            if kind in ("runtime_skill", "reference")
            else load_mode in ("always_on", "on_demand")
        )
        if not allowed:
            errors.append(f"invalid_load_mode:{resource_id}:{load_mode}")
        if kind == "rule":
            domain = resource.get("conflict_domain")
            if domain is not None and not CONFLICT_DOMAIN.match(domain):
                errors.append(f"invalid_conflict_domain:{resource_id}")
        if kind == "runtime_skill":
            metadata = resource.get("metadata")
            if (
                not isinstance(metadata, dict)
                or not SKILL_NAME.match(str(metadata.get("name", "")))
                or not str(metadata.get("description", "")).strip()
                or not isinstance(metadata.get("allow_implicit_invocation"), bool)
            ):
                errors.append(f"invalid_skill_metadata:{resource_id}")


def _validate_references(
    source: dict[str, Any], bodies: dict[str, str], errors: list[str]
) -> None:
    by_id = {r["resource_id"]: r for r in source["resources"]}
    id_by_path = {r["path"]: r["resource_id"] for r in source["resources"]}
    graph: dict[str, list[str]] = {}
    for resource in source["resources"]:
        resource_id = resource["resource_id"]
        targets: list[str] = []
        for reference in resource.get("references", []):
            raw_ref = reference.get("raw_ref", "")
            resolved = reference.get("resolved_resource_id", "")
            if not RAW_REF.match(raw_ref):
                errors.append(f"invalid_raw_ref:{resource_id}:{raw_ref}")
                continue
            if resolved not in by_id:
                errors.append(f"unresolved_reference:{resource_id}:{resolved}")
                continue
            if raw_ref not in bodies.get(resource_id, ""):
                errors.append(f"raw_ref_not_in_content:{resource_id}:{raw_ref}")
            resolved_path = _resolve_ref(resource["path"], raw_ref)
            if not resolved_path or id_by_path.get(resolved_path) != resolved:
                errors.append(
                    f"reference_path_mismatch:{resource_id}:{raw_ref}->{resolved}"
                )
            targets.append(resolved)
        graph[resource_id] = targets
    # 环检测（含自环）：三色 DFS，报错带完整循环路径。
    state: dict[str, int] = {}

    def visit(node: str, stack: list[str]) -> None:
        state[node] = 1
        for target in graph.get(node, []):
            if state.get(target) == 1:
                cycle = "->".join([*stack, node, target])
                errors.append(f"reference_cycle:{cycle}")
            elif state.get(target) is None:
                visit(target, [*stack, node])
        state[node] = 2

    for resource_id in graph:
        if state.get(resource_id) is None:
            visit(resource_id, [])


def _validate_composition(
    source: dict[str, Any], errors: list[str]
) -> None:
    composition = source["composition"]
    by_id = {r["resource_id"]: r for r in source["resources"]}
    kinds = [r["kind"] for r in source["resources"]]
    role_id = composition.get("roleDocumentId", "")
    if kinds.count("role_document") != 1 or by_id.get(role_id, {}).get("kind") != "role_document":
        errors.append("invalid_role_document")
    root_id = composition.get("rootRuntimeSkillId", "")
    if kinds.count("runtime_skill") != 1 or by_id.get(root_id, {}).get("kind") != "runtime_skill":
        errors.append("invalid_root_runtime_skill")
    rules = composition.get("ruleSet", {}).get("rules", [])
    if len(rules) != len(set(rules)):
        errors.append("duplicate_rule_reference")
    for rule_id in rules:
        if by_id.get(rule_id, {}).get("kind") != "rule":
            errors.append(f"invalid_rule_reference:{rule_id}")
    declared = {r["resource_id"] for r in source["resources"] if r["kind"] == "rule"}
    if set(rules) != declared:
        errors.append("rule_set_incomplete:RuleSet 必须显式列出全部生效 Rule")
    domains = [
        r.get("conflict_domain")
        for r in source["resources"]
        if r["kind"] == "rule" and r.get("conflict_domain")
    ]
    if len(domains) != len(set(domains)):
        errors.append("duplicate_conflict_domain")
    if not composition.get("modelProfiles"):
        errors.append("missing_model_profile")
    budget = composition.get("tokenBudget", {})
    if budget.get("estimator") != SUPPORTED_ESTIMATOR:
        errors.append(f"unsupported_token_estimator:{budget.get('estimator')}")


def _validate_budgets(
    source: dict[str, Any], token_estimates: dict[str, int], errors: list[str]
) -> None:
    composition = source["composition"]
    budget = composition["tokenBudget"]
    single_max = budget["singleResourceMaxTokens"]
    initial_max = budget["initialContextMaxTokens"]
    active_max = budget["activeContextMaxTokens"]
    java_initial = 0
    skill_extra = 0
    for resource in source["resources"]:
        estimate = token_estimates[resource["resource_id"]]
        if resource["load_mode"] == "always_on":
            java_initial += estimate
        elif estimate > single_max:
            errors.append(f"token_budget_exceeded:single:{resource['resource_id']}")
        if resource["kind"] == "runtime_skill":
            metadata = resource["metadata"]
            java_initial += estimate_tokens(
                f"{metadata['name']}\n{metadata['description']}"
            )
            # Worker 装载器更严格的口径：已解析引用 resourceId 计入初始上下文。
            for reference in resource.get("references", []):
                skill_extra += estimate_tokens(reference["resolved_resource_id"])
    # 根 Skill 自身 resourceId 也进入 Worker 初始上下文。
    skill_extra += estimate_tokens(composition["rootRuntimeSkillId"])
    worker_initial = java_initial + skill_extra
    if worker_initial > initial_max:
        errors.append(
            f"token_budget_exceeded:initial:{worker_initial}>{initial_max}"
        )
    if worker_initial > active_max:
        errors.append("token_budget_exceeded:active")
    for resource in source["resources"]:
        if resource["load_mode"] == "on_demand" and (
            java_initial + token_estimates[resource["resource_id"]] > active_max
        ):
            errors.append(f"token_budget_exceeded:active:{resource['resource_id']}")


def build_package() -> dict[str, Any]:
    """构建便携包；静态校验失败抛 BuildError（携带错误列表）。"""
    source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    errors: list[str] = []
    bundle_version_id = source.get("bundle_version_id", "")
    if not IDENTIFIER.match(bundle_version_id):
        errors.append(f"invalid_bundle_version_id:{bundle_version_id}")
    if not SEMVER.match(source.get("version", "")):
        errors.append(f"invalid_version:{source.get('version')}")
    bodies = _load_resource_bodies(source, errors)
    _validate_resource_shapes(source, errors)
    if not errors:
        _validate_references(source, bodies, errors)
        _validate_composition(source, errors)
    token_estimates = {
        r["resource_id"]: estimate_tokens(bodies.get(r["resource_id"], ""))
        for r in source["resources"]
    }
    if not errors:
        _validate_budgets(source, token_estimates, errors)
    if errors:
        raise BuildError(errors)

    # 每个资源的摘要/大小只算一次，manifest 与便携包两个循环共享查表。
    content_digests = {
        r["resource_id"]: content_digest(bodies[r["resource_id"]])
        for r in source["resources"]
    }
    size_bytes = {
        r["resource_id"]: len(bodies[r["resource_id"]].encode("utf-8"))
        for r in source["resources"]
    }

    # manifest（camelCase 契约形状，resources 按 resourceId 排序，与 Java 发布一致）
    manifest_resources: list[dict[str, Any]] = []
    for resource in sorted(source["resources"], key=lambda r: r["resource_id"]):
        resource_id = resource["resource_id"]
        entry: dict[str, Any] = {
            "resourceId": resource_id,
            "revision": resource["revision"],
            "kind": resource["kind"],
            "path": resource["path"],
            "mediaType": resource["media_type"],
            "loadMode": resource["load_mode"],
            "contentDigest": content_digests[resource_id],
            "sizeBytes": size_bytes[resource_id],
            "tokenEstimate": token_estimates[resource_id],
            "references": [
                {
                    "rawRef": reference["raw_ref"],
                    "resolvedResourceId": reference["resolved_resource_id"],
                }
                for reference in resource.get("references", [])
            ],
        }
        if resource["kind"] == "rule":
            entry["conflictDomain"] = resource.get("conflict_domain")
        if resource["kind"] == "runtime_skill":
            metadata = resource["metadata"]
            entry["metadata"] = {
                "name": metadata["name"],
                "description": metadata["description"],
                "allowImplicitInvocation": metadata["allow_implicit_invocation"],
            }
        manifest_resources.append(entry)
    manifest: dict[str, Any] = {
        "formatVersion": 1,
        "baseUri": f"bw-bundle://{bundle_version_id}/",
        "digestAlgorithm": "sha256",
        "resources": manifest_resources,
    }
    manifest["manifestDigest"] = manifest_digest(manifest)

    composition = dict(source["composition"])
    composition["resourceManifest"] = manifest

    package_resources: list[dict[str, Any]] = []
    for resource in sorted(source["resources"], key=lambda r: r["resource_id"]):
        resource_id = resource["resource_id"]
        body = bodies[resource_id]
        entry = {key: value for key, value in resource.items()}
        entry["content_digest"] = content_digests[resource_id]
        entry["size_bytes"] = size_bytes[resource_id]
        entry["token_estimate"] = token_estimates[resource_id]
        entry["content"] = body
        package_resources.append(entry)

    return {
        "format_version": 1,
        "bundle_version_id": bundle_version_id,
        "source_agent_definition_id": source["source_agent_definition_id"],
        "version": source["version"],
        "composition": composition,
        "resources": package_resources,
    }


def render_package(package: dict[str, Any]) -> str:
    return json.dumps(package, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="只校验并比对 dist 是否最新，不写入"
    )
    args = parser.parse_args()
    try:
        package = build_package()
    except BuildError as error:
        for message in error.args[0]:
            print(f"ERROR {message}", file=sys.stderr)
        return 1
    rendered = render_package(package)
    if args.check:
        if not DIST_PATH.exists() or DIST_PATH.read_text(encoding="utf-8") != rendered:
            print("dist/first-runtime-bundle.json 已过期，请重新运行 build.py", file=sys.stderr)
            return 1
        print("dist 与源一致")
        return 0
    DIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    DIST_PATH.write_text(rendered, encoding="utf-8")
    digest = package["composition"]["resourceManifest"]["manifestDigest"]
    print(f"已生成 {DIST_PATH.relative_to(REPO_ROOT)} manifestDigest={digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
