#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import re
import subprocess
import sys
import time

CANVAS_ID = 309
DB_NAME = "blue_whale"
BACKUP_DIR = "/tmp"
RECOVER_SRC = os.environ.get("RECOVER_SRC", "/tmp/recover-434-nodes.json")

def _build_latin1_reverse() -> dict:
    rev = {}
    for b in range(0x100):
        try:
            rev[bytes([b]).decode("cp1252")] = b
        except UnicodeDecodeError:
            rev[chr(b)] = b
    return rev

LATIN1_REVERSE = _build_latin1_reverse()
MOJIBAKE_MARKERS = "€‰Š‹ŒŽ™š›œžŸ"


def restore_mojibake(text):
    out = []
    i = 0
    n = len(text)
    segs_replaced = 0
    while i < n:
        ch = text[i]
        if ch in LATIN1_REVERSE:
            j = i
            while j < n and text[j] in LATIN1_REVERSE:
                j += 1
            seg = text[i:j]
            raw = bytes(LATIN1_REVERSE[c] for c in seg)
            try:
                decoded = raw.decode("utf-8")
                out.append(decoded)
                segs_replaced += 1
            except UnicodeDecodeError:
                out.append(seg)
            i = j
        else:
            out.append(ch)
            i += 1
    return "".join(out), segs_replaced


def has_mojibake_residue(text):
    hits = sorted({c for c in text if c in MOJIBAKE_MARKERS})
    again, replaced = restore_mojibake(text)
    if replaced > 0 and again != text:
        hits.append("<restorable-segment>")
    return hits


def mysql_query(sql):
    args = ["mysql", "--default-character-set=utf8mb4", "-N", "-B"]
    args += os.environ.get("MYSQL_ARGS", "").split()
    args += [DB_NAME, "-e", sql]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"mysql 查询失败: {proc.stderr.strip()}")
    return proc.stdout


def fetch_canvas_row():
    out = mysql_query(
        f"SELECT version, HEX(nodes_json), HEX(edges_json), LENGTH(nodes_json) "
        f"FROM canvas WHERE id = {CANVAS_ID}"
    ).strip()
    if not out:
        raise RuntimeError(f"canvas {CANVAS_ID} 不存在")
    version_s, nodes_hex, edges_hex, length_s = out.split("\t")
    return {
        "version": int(version_s),
        "nodes_json": bytes.fromhex(nodes_hex).decode("utf-8"),
        "edges_json": bytes.fromhex(edges_hex).decode("utf-8"),
        "nodes_length": int(length_s),
    }


def hex_json_expr(text):
    return f"CONVERT(UNHEX('{text.encode('utf-8').hex().upper()}') USING utf8mb4)"


def write_backup(row):
    ts = time.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(BACKUP_DIR, f"canvas-309-pre-ikij40-{ts}.sql")
    with open(path, "w", encoding="ascii") as f:
        f.write(f"-- IKIJ40 row backup: canvas {CANVAS_ID}, version={row['version']}, {ts}\n")
        f.write(f"-- rollback: mysql --default-character-set=utf8mb4 blue_whale < this-file\n")
        f.write(
            f"UPDATE canvas SET nodes_json = {hex_json_expr(row['nodes_json'])}, "
            f"edges_json = {hex_json_expr(row['edges_json'])}, "
            f"version = {row['version']} WHERE id = {CANVAS_ID};\n"
        )
    return path


def diff_nodes(restored, source_path, allowed_missing=None):
    allowed = set(allowed_missing or [])
    with open(source_path, "r", encoding="utf-8") as f:
        source = json.load(f)
    current = json.loads(restored)
    src_by_id = {str(n.get("id")): json.dumps(n, ensure_ascii=False, sort_keys=True) for n in source}
    cur_by_id = {str(n.get("id")): json.dumps(n, ensure_ascii=False, sort_keys=True) for n in current}
    missing, extra, changed = [], [], []
    for node_id, src_json in src_by_id.items():
        if node_id not in cur_by_id:
            missing.append(node_id)
        elif cur_by_id[node_id] != src_json:
            changed.append(node_id)
    for node_id in cur_by_id:
        if node_id not in src_by_id:
            extra.append(node_id)
    unexpected_missing = [n for n in missing if n not in allowed]
    matched_count = len(src_by_id) - len(missing) - len(changed)
    return {
        "total_source": len(source),
        "total_restored": len(current),
        "matched": matched_count,
        "missing": missing,
        "allowed_missing": sorted(allowed & set(missing)),
        "unexpected_missing": unexpected_missing,
        "extra": extra,
        "changed": changed,
        "all_match": not unexpected_missing and not changed,
    }


def apply_fix(restored_nodes, expected_version):
    sql = (
        f"UPDATE canvas SET nodes_json = {hex_json_expr(restored_nodes)}, "
        f"version = version + 1 "
        f"WHERE id = {CANVAS_ID} AND version = {expected_version}; "
        f"SELECT ROW_COUNT();"
    )
    out = mysql_query(sql).strip()
    return out == "1"


def verify_post(row_after, restored_nodes, row_before, version_before):
    errors = []
    try:
        json.loads(row_after["nodes_json"])
        json.loads(row_after["edges_json"])
    except json.JSONDecodeError as e:
        return [f"JSON 不合法: {e}"]
    if row_after["edges_json"] != row_before["edges_json"]:
        errors.append("edges_json 与写前快照不一致（本修复不应触碰连线）")
    residue = has_mojibake_residue(row_after["nodes_json"])
    if residue:
        errors.append(f"CP1252 双重编码残留: {residue[:10]}")
    if row_after["nodes_json"] != restored_nodes:
        errors.append("回读内容与离线还原结果不一致")
    if row_after["version"] != version_before + 1:
        errors.append(f"版本推进异常: {version_before} -> {row_after['version']}（期望 +1）")
    return errors


def main() -> int:
    execute = "--execute" in sys.argv
    allow_missing = []
    if "--allow-missing" in sys.argv:
        i = sys.argv.index("--allow-missing")
        if i + 1 >= len(sys.argv):
            print("❌ --allow-missing 需要逗号分隔的节点 id 参数")
            return 2
        allow_missing = [x for x in sys.argv[i + 1].split(",") if x]
    print(f"== IKIJ40 canvas {CANVAS_ID} 乱码修复 {'[EXECUTE]' if execute else '[DRY-RUN]'} ==")

    row = fetch_canvas_row()
    print(f"当前 version={row['version']}, nodes_json {row['nodes_length']} 字节")

    backup_path = write_backup(row)
    print(f"[1] 行级备份: {backup_path}")

    restored, segs = restore_mojibake(row["nodes_json"])
    print(f"[2] 段级还原: 替换 {segs} 段, {len(row['nodes_json'])} -> {len(restored)} 字符")
    residue = has_mojibake_residue(restored)
    if residue:
        print(f"⚠️ 还原后仍有残留特征: {residue[:10]}")

    if not os.path.exists(RECOVER_SRC):
        print(f"❌ 恢复源不存在: {RECOVER_SRC}，无法预演，拒绝继续")
        return 2
    diff = diff_nodes(restored, RECOVER_SRC, allow_missing)
    print(f"[3] dry-run diff: 源 {diff['total_source']} 节点, 还原 {diff['total_restored']} 节点, "
          f"一致 {diff['matched']}, 缺失 {len(diff['missing'])}(豁免 {len(diff['allowed_missing'])}), "
          f"多出 {len(diff['extra'])}, 内容差异 {len(diff['changed'])}")
    for node_id in diff["changed"][:5]:
        print(f"   - 内容差异节点 {node_id}")
    for node_id in diff["unexpected_missing"][:5]:
        print(f"   - 未豁免缺失节点 {node_id}")
    for node_id in diff["extra"][:5]:
        print(f"   - 多出节点（乱码期间用户新增，算法未触碰）: {node_id}")

    audit = {
        "ticket": "IKIJ40",
        "canvas_id": CANVAS_ID,
        "mode": "execute" if execute else "dry-run",
        "backup_path": backup_path,
        "version_before": row["version"],
        "segs_replaced": segs,
        "nodes_bytes_before": row["nodes_length"],
        "nodes_chars_after": len(restored),
        "residue_after_restore": residue,
        "diff": diff,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    if not diff["all_match"]:
        print("❌ dry-run 未达 37/37 一致，按闸门约定不写入；差异详情见审计文件")
        audit["gate"] = "BLOCKED: diff not all-match"
        _dump_audit(audit)
        return 3

    if not execute:
        audit["gate"] = (f"dry-run PASSED (matched {diff['matched']}/{diff['total_source']}, "
                         f"allowed-missing {diff['allowed_missing']}); 未写入（加 --execute 并获授权后执行）")
        _dump_audit(audit)
        print(f"✅ dry-run 通过（{diff['matched']}/{diff['total_source']} 一致），未写入任何数据")
        return 0

    print("[4] 写入（version 乐观锁闸）…")
    if not apply_fix(restored, row["version"]):
        print("❌ UPDATE 0 命中：期间有新的自动保存（版本已变化），停止且不重试")
        audit["gate"] = "BLOCKED: version conflict"
        _dump_audit(audit)
        return 4
    row_after = fetch_canvas_row()
    errors = verify_post(row_after, restored, row, row["version"])
    audit["version_after"] = row_after["version"]
    audit["post_verify_errors"] = errors
    if errors:
        audit["gate"] = "POST-VERIFY FAILED"
        _dump_audit(audit)
        print(f"❌ 写后校验失败: {errors}；可用备份回滚: {backup_path}")
        return 5
    audit["gate"] = "FIXED & VERIFIED"
    _dump_audit(audit)
    print(f"✅ 修复完成并回读校验通过：version {row['version']} -> {row_after['version']}，"
          f"回滚可用 {backup_path}")
    return 0


def _dump_audit(audit):
    path = os.path.join(BACKUP_DIR, f"ikij40-canvas-309-audit-{time.strftime('%Y%m%d-%H%M%S')}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(audit, f, ensure_ascii=False, indent=2)
    print(f"[audit] {path}")
    return path


if __name__ == "__main__":
    sys.exit(main())
