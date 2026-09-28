#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IKIJ40（父单 IKIJ3K）：测试站 project 434 / canvas 309 nodes_json 乱码一次性修复脚本。

事故：09-25 12:59 恢复 SQL 经默认 latin1 的 mysql 客户端执行，恢复源文件的
UTF-8 字节被服务器按 latin1(CP1252) 解码为字符，再以 utf8mb4 双重编码存入
nodes_json。受损仅 canvas 309 一行；本脚本仅触碰该行。

算法（应用层段级 CP1252 逆映射，诊断期已对 37 节点验证逐字节一致）：
  把文本中连续的「MySQL latin1 可逆字符」（U+0000..U+00FF）段转回字节，
  整段通过 UTF-8 合法性校验则替换为解码结果，失败则原样保留。
  正常中文（U+4E00+）不在可逆集，天然不受触碰；用户乱码期间手动修正的
  正常中文因此安全保留。禁止 MySQL CONVERT(BINARY CONVERT(x USING latin1))
  整字段转换——正常中文会被转成 ? 造成真实丢失。

流程（--execute 前两步零写入；写库须人工授权后执行）：
  1. 读取当前 canvas 309（经 HEX 取回，免疫客户端字符集）；
  2. 行级备份写入 /tmp（纯 ASCII 十六进制 SQL，任何字符集客户端可无损还原）；
  3. dry-run：离线还原 + 与恢复源 /tmp/recover-434-nodes.json 逐节点 diff，
     37/37 一致才放行；不一致只报告不写入；
  4. --execute：UPDATE 带 version 乐观锁闸（0 命中即停止，不重试）；
  5. 写后回读校验：JSON 合法、37 节点 30 连线、无 CP1252 双重编码残留
     （幂等性检验 + 特征字符扫描）、与离线还原逐字节一致、版本恰推进 1；
  6. 审计报告写 /tmp/ikij40-canvas-309-audit-*.json。

用法（测试站服务器上执行）：
  python3 fix-ikij40-canvas-309-mojibake.py                       # dry-run（零写入）
  python3 fix-ikij40-canvas-309-mojibake.py --execute             # 写入（须先 dry-run 通过并获授权）
  python3 ... --allow-missing id1,id2                             # 豁免用户已确认主动删除的源节点
环境变量：
  MYSQL_ARGS   附加 mysql 连接参数（如 "-h 127.0.0.1 -u root"），凭据不落本脚本
  MYSQL_PWD    mysql 客户端原生密码环境变量（凭据不进命令行）
  RECOVER_SRC  恢复源文件路径（默认 /tmp/recover-434-nodes.json）
"""

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

# ── MySQL latin1 逆向映射（cp1252 + 0x81/0x8D/0x8F/0x90/0x9D 五个直通 C1）──
def _build_latin1_reverse() -> dict:
    rev = {}
    for b in range(0x100):
        try:
            rev[bytes([b]).decode("cp1252")] = b
        except UnicodeDecodeError:  # cp1252 未定义的 5 个位置，MySQL latin1 直通
            rev[chr(b)] = b
    return rev

LATIN1_REVERSE = _build_latin1_reverse()
# CP1252 特有映射字符，正常中文产品内容中不应出现（工单点名 € ™ Œ œ š ž 一类）。
# 不含 – — ‘ ’ “ ” … 等正常标点：原文里合法存在的 em dash 不算双重编码残留
# （09-25 诊断实证：位置 383 的 â€" 还原后就是 em dash）。
MOJIBAKE_MARKERS = "€‰Š‹ŒŽ™š›œžŸ"


def restore_mojibake(text):
    """段级 CP1252 逆映射还原。返回 (还原文本, 替换段数)。"""
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
                out.append(seg)  # 失败段原样保留（安全侧：宁可漏还原不可错还原）
            i = j
        else:
            out.append(ch)
            i += 1
    return "".join(out), segs_replaced


def has_mojibake_residue(text):
    """双重编码残留检测：特征字符扫描 + 幂等性（再还原应无变化）。"""
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
    """经 HEX 取回当前行，绕过任何客户端字符集转换。"""
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
    """文本 → 纯 ASCII 十六进制 JSON 写入表达式：任何字符集客户端执行都无损。"""
    return f"CONVERT(UNHEX('{text.encode('utf-8').hex().upper()}') USING utf8mb4)"


def write_backup(row):
    """行级备份：纯 ASCII 十六进制 SQL，与 09-25 /tmp/canvas-309-pre-recover.sql 同口径可回滚。"""
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
    """离线还原结果与恢复源逐节点 diff（按节点 id 配对，规范化 JSON 比较）。

    allowed_missing：用户已确认主动删除的源节点 id——从闸门豁免（matched 口径同步核减），
    但如实记录进审计；其余任何缺失/多出/内容差异仍阻断。"""
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
        # 闸门口径：恢复源全部节点 matched 或已豁免（用户确认删除），零内容差异。
        # 源节点总数以恢复源文件为准（本单事实值 37，不硬编码进闸门）。
        "all_match": not unexpected_missing and not changed,
    }


def apply_fix(restored_nodes, expected_version):
    """带乐观锁版本闸写入；0 命中返回 False（期间有新自动保存，不重试）。"""
    sql = (
        f"UPDATE canvas SET nodes_json = {hex_json_expr(restored_nodes)}, "
        f"version = version + 1 "
        f"WHERE id = {CANVAS_ID} AND version = {expected_version}; "
        f"SELECT ROW_COUNT();"
    )
    out = mysql_query(sql).strip()
    return out == "1"


def verify_post(row_after, restored_nodes, row_before, version_before):
    """写后回读校验，返回失败项列表（空 = 全过）。

    写入完整性由「回读与离线还原结果逐字节一致」保证（覆盖截断/部分写入），
    节点集合合法性由 dry-run 闸门在写前把关。
    连线守恒口径：本修复只写 nodes_json，edges 必须与写前快照逐字节一致——
    用户后续编辑增删连线是画布自身状态演进，连线数本身不是固定常量。"""
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
