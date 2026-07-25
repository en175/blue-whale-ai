"""已激活 Creative Skill 正文 / 引用资源读取闸门（契约 §6 / IK3NPD-T3）。

Creative Skill 独立于 Runtime Bundle（不进 manifest）：本闸门按 Run pin 固定的
``resource_digest`` 与响应 ``content_digest`` 对正文字节做双重 SHA-256 校验，引用资源
做单重校验（响应 ``content_digest``）。字节缺失 → ``CREATIVE_SKILL_CONTENT_MISSING``；
任一摘要 / 身份不符 → ``CREATIVE_SKILL_DIGEST_MISMATCH``，均 fail closed，不降级默认
提示词、不换版本、不使用缓存替代品。token 估算与 ``ReadEvidence`` 记账复用 Bundle 同口径
（``chars_div_4``，``origin`` 区分 ``creative_skill_*``），证据随 commit ``bundle_evidence``
回传（ADR-0042 D2）。

正文按 ``agent_run_id`` 寻址（Run-scoped）：Java 从 Run pin 派生固定版本，客户端不能改读
其他版本；同 Run 正文幂等（只 GET 一次，缓存不可变字节），恢复同一 Run 仍用同一 pin。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .bundle.canonical import sha256_hex
from .bundle.errors import (
    CREATIVE_SKILL_CONTENT_MISSING,
    CREATIVE_SKILL_DIGEST_MISMATCH,
    BundleError,
)
from .bundle.gate import ReadEvidence
from .bundle.tokens import estimate_chars_div_4
from .contracts import CreativeSkillActivation, CreativeSkillContentSource

ORIGIN_CREATIVE_SKILL_BODY = "creative_skill_body"
ORIGIN_CREATIVE_SKILL_REFERENCE = "creative_skill_reference"

# 引用资源规范化 POSIX 相对路径（schema ResourcePath）：禁止绝对路径 / 反斜杠 / 点段 / 双斜杠。
_RESOURCE_PATH_RE = re.compile(
    r"^(?!/)(?!.*\\)(?!.*(?:^|/)\.{1,2}(?:/|$))(?!.*//)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$"
)


def _sha256_text(text: str) -> str:
    return "sha256:" + sha256_hex(text)


def _is_valid_resource_path(path: Any) -> bool:
    return (
        isinstance(path, str)
        and 1 <= len(path) <= 512
        and bool(_RESOURCE_PATH_RE.match(path))
    )


class CreativeSkillContentGate:
    """单个 AgentRun 已激活 Creative Skill 的正文 / 引用资源读取闸门。

    持有 Run pin 的激活记录（含 ``resource_digest`` 正文摘要）与 Run-scoped 内容源。
    forced 激活非空时由 Orchestrator 在 provider 调用前 ``read_body`` 装正文进上下文；
    引用资源按需 ``read_reference``。空激活不构造本闸门、不读取（契约 §6）。
    """

    def __init__(
        self,
        source: CreativeSkillContentSource,
        activation: CreativeSkillActivation,
        run_id: int,
    ) -> None:
        self._source = source
        self._activation = activation
        self._run_id = run_id
        # 正文幂等缓存：同 Run 正文字节不可变，重复读取命中缓存不再 GET、不重算 digest。
        self._body: str | None = None
        self._ledger: list[ReadEvidence] = []

    @property
    def activation(self) -> CreativeSkillActivation:
        return self._activation

    def read_body(self) -> str:
        """读取激活版本正文（契约 §6 ``CreativeSkillBodyResponse``）。

        双重 digest 校验：实际字节 SHA-256 必须同时匹配响应 ``content_digest`` 与 Run pin
        ``resource_digest``；响应身份（Skill / 版本）与媒体类型（恒 ``text/markdown``）也必须
        与 pin 一致。任一不符 → ``CREATIVE_SKILL_DIGEST_MISMATCH``；正文缺失 →
        ``CREATIVE_SKILL_CONTENT_MISSING``。
        """
        if self._body is not None:
            return self._body
        try:
            response = self._source.fetch_creative_skill_body(self._run_id)
        except BundleError:
            raise
        except Exception as exc:
            # 源端任何异常（含字节缺失）都 fail closed，绝不回退默认提示词。
            raise BundleError(
                CREATIVE_SKILL_CONTENT_MISSING, "无法读取 Creative Skill 正文"
            ) from exc
        body = _body_text(response)
        _verify_body_identity(response, self._activation)
        content_digest = _response_digest(response)
        actual = _sha256_text(body)
        if actual != content_digest or actual != self._activation.resource_digest:
            raise BundleError(
                CREATIVE_SKILL_DIGEST_MISMATCH, "Creative Skill 正文摘要与固定摘要不符"
            )
        self._body = body
        self._ledger.append(
            ReadEvidence(
                resource_id=f"creative_skill:{self._activation.creative_skill_id}:body",
                revision=0,
                content_digest=actual,
                token_estimate=estimate_chars_div_4(body),
                origin=ORIGIN_CREATIVE_SKILL_BODY,
            )
        )
        return body

    def read_reference(self, resource_path: str) -> str:
        """读取单个引用资源（契约 §6 ``CreativeSkillReferenceResourceResponse``）。

        单重 digest 校验：实际字节 SHA-256 匹配响应 ``content_digest``（引用资源无 pin 固定
        摘要）。路径必须规范化（schema ResourcePath）；响应身份 / 路径必须与请求一致。按需
        读取，不预加载全部引用资源。
        """
        if not _is_valid_resource_path(resource_path):
            raise BundleError(CREATIVE_SKILL_CONTENT_MISSING, "引用资源路径非法")
        try:
            response = self._source.fetch_creative_skill_reference(
                self._run_id, resource_path
            )
        except BundleError:
            raise
        except Exception as exc:
            raise BundleError(
                CREATIVE_SKILL_CONTENT_MISSING, "无法读取 Creative Skill 引用资源"
            ) from exc
        content = _reference_text(response)
        _verify_reference_identity(response, self._activation, resource_path)
        content_digest = _response_digest(response)
        actual = _sha256_text(content)
        if actual != content_digest:
            raise BundleError(
                CREATIVE_SKILL_DIGEST_MISMATCH, "Creative Skill 引用资源摘要不符"
            )
        self._ledger.append(
            ReadEvidence(
                resource_id=(
                    f"creative_skill:{self._activation.creative_skill_id}"
                    f":reference:{resource_path}"
                ),
                revision=0,
                content_digest=actual,
                token_estimate=estimate_chars_div_4(content),
                origin=ORIGIN_CREATIVE_SKILL_REFERENCE,
            )
        )
        return content

    def evidence(self) -> tuple[ReadEvidence, ...]:
        return tuple(self._ledger)


def _body_text(response: Any) -> str:
    body = response.get("body") if isinstance(response, Mapping) else None
    if not isinstance(body, str) or body == "":
        raise BundleError(CREATIVE_SKILL_CONTENT_MISSING, "Creative Skill 正文缺失")
    return body


def _reference_text(response: Any) -> str:
    content = response.get("content") if isinstance(response, Mapping) else None
    if not isinstance(content, str):
        raise BundleError(CREATIVE_SKILL_CONTENT_MISSING, "Creative Skill 引用资源正文缺失")
    return content


def _response_digest(response: Any) -> str:
    digest = response.get("content_digest") if isinstance(response, Mapping) else None
    if not isinstance(digest, str) or not digest.startswith("sha256:"):
        # 响应缺少有效摘要属服务端违约，归摘要不符 fail closed。
        raise BundleError(CREATIVE_SKILL_DIGEST_MISMATCH, "响应缺少有效 content_digest")
    return digest


def _verify_body_identity(
    response: Any, activation: CreativeSkillActivation
) -> None:
    if not isinstance(response, Mapping):
        raise BundleError(CREATIVE_SKILL_DIGEST_MISMATCH, "正文响应不是对象")
    if response.get("media_type") != "text/markdown":
        raise BundleError(CREATIVE_SKILL_DIGEST_MISMATCH, "Creative Skill 正文媒体类型不符")
    if (
        response.get("creative_skill_id") != activation.creative_skill_id
        or response.get("creative_skill_version_id") != activation.creative_skill_version_id
    ):
        raise BundleError(CREATIVE_SKILL_DIGEST_MISMATCH, "正文响应身份与 Run pin 不符")


def _verify_reference_identity(
    response: Any, activation: CreativeSkillActivation, resource_path: str
) -> None:
    if not isinstance(response, Mapping):
        raise BundleError(CREATIVE_SKILL_DIGEST_MISMATCH, "引用资源响应不是对象")
    if (
        response.get("creative_skill_id") != activation.creative_skill_id
        or response.get("creative_skill_version_id") != activation.creative_skill_version_id
        or response.get("resource_path") != resource_path
    ):
        raise BundleError(CREATIVE_SKILL_DIGEST_MISMATCH, "引用资源响应身份 / 路径与请求不符")
