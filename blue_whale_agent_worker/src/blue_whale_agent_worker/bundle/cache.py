"""内容寻址资源缓存装饰层（契约 §6 / IK2QBP）。

``CachingBundleSource`` 装饰 ``BundleSource``：以资源正文的 ``sha256`` 为键、按
``bundleVersionId`` 派生命名空间隔离，把已验证的资源正文落到本地磁盘。同一内容在同一
BundleVersion 下只从内层（Java 控制面）拉取一次，后续读取（含 Worker 进程重启后的再次
读取）命中磁盘缓存，零网络请求。

缓存是加速器而非权威：

- 取用前按 digest 校验磁盘正文身份——读回字节重算 ``sha256`` 比对键名，不符则丢弃该项
  并回源重拉，绝不用脏数据；回源拉到的正文仍由上层 ``ResourceGate`` 用 manifest 固化的
  ``contentDigest`` 做权威校验（``BUNDLE_RESOURCE_DIGEST_MISMATCH``，已有错误码）。
- 缓存层不向装载器 / ResourceGate 暴露任何新错误类别；磁盘损坏 / 索引丢失 / IO 异常
  一律静默回源，重新全量验证。

命名空间与键：

- 目录 = ``sha256(bundleVersionId)``（hex），按版本隔离且杜绝路径穿越，不明文落
  bundleVersionId；不同 BundleVersion 的缓存绝不串用。
- 正文文件名 = ``sha256(content)``（hex），内容寻址、不含可猜测路径。
- ``index.json`` 记录 ``resourceId → 正文 sha256``，仅为命中查找辅助。

清理：写后惰性扫描，按版本目录 ``mtime`` 淘汰最旧命名空间，使总占用 ``<= max_bytes``。
``fetch_snapshot`` 透传不缓存——发布快照由 ``BundleVerifier`` 每次重算 ``manifestDigest``
校验，是运行时安全锚点（契约 §6 第 1 条 / 第 5 条 fail closed）。
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .source import BundleSource

_DEFAULT_MAX_BYTES = 64 * 1024 * 1024
_INDEX_NAME = "index.json"


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def default_cache_dir() -> Path:
    """资源缓存根目录：临时目录下的固定子目录（跨进程重启持久命中）。"""
    return Path(tempfile.gettempdir()) / "blue-whale-resource-cache"


class CachingBundleSource:
    """``BundleSource`` 的内容寻址磁盘缓存装饰层。"""

    def __init__(
        self,
        inner: BundleSource,
        cache_dir: Path,
        *,
        max_bytes: int = _DEFAULT_MAX_BYTES,
    ) -> None:
        self._inner = inner
        self._cache_dir = Path(cache_dir)
        self._max_bytes = max_bytes
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    def fetch_snapshot(self, bundle_version_id: str) -> Mapping[str, Any]:
        # 发布快照透传：manifestDigest 校验是安全锚点，每次重算，不缓存。
        return self._inner.fetch_snapshot(bundle_version_id)

    def fetch_resource(
        self, bundle_version_id: str, resource_id: str
    ) -> Mapping[str, Any]:
        ns = self._namespace_dir(bundle_version_id)
        index = self._read_index(ns)
        digest = index.get(resource_id)
        if digest is not None:
            body = self._read_body(ns, digest)
            content = body.get("content") if isinstance(body, Mapping) else None
            if isinstance(content, str) and _sha256_hex(content) == digest:
                return body  # 命中：读回重算 sha256 已校验身份，零网络
            self._delete_body(ns, digest)  # 损坏 / 被篡改：丢弃，绝不返回脏数据
            index.pop(resource_id, None)
        # 未命中 / 损坏：回源全量拉取（上层 ResourceGate 仍做 manifest digest 权威校验）
        body = self._inner.fetch_resource(bundle_version_id, resource_id)
        content = body.get("content") if isinstance(body, Mapping) else None
        if isinstance(content, str):
            digest = _sha256_hex(content)
            self._write_body(ns, digest, body)
            index[resource_id] = digest
            self._write_index(ns, index)
            self._maybe_evict(current_ns=ns)
        return body

    def _namespace_dir(self, bundle_version_id: str) -> Path:
        # sha256 派生目录名：按版本隔离 + 防路径穿越，不明文落 bundleVersionId。
        return self._cache_dir / _sha256_hex(bundle_version_id)

    def _read_index(self, ns: Path) -> dict[str, str]:
        data = self._load_json(ns / _INDEX_NAME)
        return data if isinstance(data, dict) else {}

    def _write_index(self, ns: Path, index: Mapping[str, str]) -> None:
        self._dump_json(ns, _INDEX_NAME, index)

    def _read_body(self, ns: Path, digest: str) -> Mapping[str, Any] | None:
        data = self._load_json(ns / digest)
        return data if isinstance(data, Mapping) else None

    def _write_body(self, ns: Path, digest: str, body: Mapping[str, Any]) -> None:
        self._dump_json(ns, digest, body)

    def _load_json(self, path: Path) -> Any:
        try:
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def _dump_json(self, ns: Path, name: str, obj: Any) -> None:
        ns.mkdir(parents=True, exist_ok=True)
        self._atomic_write(ns / name, json.dumps(obj, ensure_ascii=False))

    def _delete_body(self, ns: Path, digest: str) -> None:
        try:
            (ns / digest).unlink()
        except OSError:
            pass

    def _atomic_write(self, path: Path, text: str) -> None:
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)

    def _maybe_evict(self, *, current_ns: Path) -> None:
        try:
            namespaces = [d for d in self._cache_dir.iterdir() if d.is_dir()]
        except OSError:
            return
        total = sum(_dir_size(d) for d in namespaces)
        if total <= self._max_bytes:
            return
        # 按 mtime 升序淘汰最旧命名空间，保护当前刚写的 current_ns
        for d in sorted(namespaces, key=lambda p: p.stat().st_mtime_ns):
            if total <= self._max_bytes:
                return
            if d == current_ns:
                continue
            total -= _dir_size(d)
            _remove_tree(d)


def _dir_size(path: Path) -> int:
    total = 0
    try:
        for entry in path.iterdir():
            if entry.is_file():
                total += entry.stat().st_size
    except OSError:
        pass
    return total


def _remove_tree(path: Path) -> None:
    try:
        for entry in path.iterdir():
            if entry.is_file():
                entry.unlink()
        path.rmdir()
    except OSError:
        pass
