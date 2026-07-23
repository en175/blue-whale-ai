import hashlib
import unittest

from blue_whale_agent_worker.streaming import (
    CHUNK_WINDOW,
    ChunkFormer,
    operation_idempotency_key,
    sha256_text,
)


def _former(stream_id: str = "assistant-test") -> ChunkFormer:
    return ChunkFormer(
        run_id=23,
        stream_id=stream_id,
        review_evidence={"source": "worker-prefix"},
    )


class OperationIdempotencyKeyTest(unittest.TestCase):
    def test_key_is_deterministic_and_within_64_chars(self) -> None:
        key = operation_idempotency_key(23, "start")

        self.assertEqual(key, operation_idempotency_key(23, "start"))
        self.assertLessEqual(len(key), 64)

    def test_key_varies_by_run_and_operation(self) -> None:
        self.assertNotEqual(
            operation_idempotency_key(23, "start"),
            operation_idempotency_key(24, "start"),
        )
        self.assertNotEqual(
            operation_idempotency_key(23, "start"),
            operation_idempotency_key(23, "complete"),
        )


class ChunkFormerTest(unittest.TestCase):
    def test_full_window_chunks_are_emitted_at_64_chars(self) -> None:
        former = _former()
        text = "块" * (CHUNK_WINDOW * 2 + 10)

        chunks = former.feed(text)

        self.assertEqual(2, len(chunks))
        self.assertEqual("块" * CHUNK_WINDOW, chunks[0]["content"])
        self.assertEqual([1, 2], [chunk["sequence_no"] for chunk in chunks])

        tail, digest, final_sequence_no = former.finish()
        self.assertEqual(1, len(tail))
        self.assertEqual("块" * 10, tail[0]["content"])
        self.assertEqual(3, tail[0]["sequence_no"])
        self.assertEqual(3, final_sequence_no)
        self.assertEqual(text, former.full_text)
        self.assertEqual(
            hashlib.sha256(text.encode("utf-8")).hexdigest(), digest
        )

    def test_window_spans_feed_boundaries(self) -> None:
        former = _former()

        self.assertEqual([], former.feed("甲" * 40))
        chunks = former.feed("乙" * 40)

        # 跨 feed 边界的 64 字符满窗：40 + 24 成块，余 16 留存。
        self.assertEqual(1, len(chunks))
        self.assertEqual("甲" * 40 + "乙" * 24, chunks[0]["content"])

        tail, _, final_sequence_no = former.finish()
        self.assertEqual("乙" * 16, tail[0]["content"])
        self.assertEqual(2, final_sequence_no)
        self.assertEqual("甲" * 40 + "乙" * 40, former.full_text)

    def test_empty_text_produces_no_chunks(self) -> None:
        former = _former()

        tail, digest, final_sequence_no = former.finish()

        self.assertEqual([], tail)
        self.assertEqual(sha256_text(""), digest)
        self.assertEqual(0, final_sequence_no)
        self.assertEqual("", former.full_text)

    def test_chunk_payload_carries_stream_protocol_fields(self) -> None:
        former = _former(stream_id="assistant-xyz")

        chunks = former.feed("文" * CHUNK_WINDOW)

        chunk = chunks[0]
        self.assertEqual("assistant-xyz", chunk["stream_id"])
        self.assertEqual(1, chunk["sequence_no"])
        self.assertEqual("文" * CHUNK_WINDOW, chunk["content"])
        self.assertEqual({"source": "worker-prefix"}, chunk["review_evidence"])
        self.assertLessEqual(len(chunk["idempotency_key"]), 64)
        # chunk payload 不含 provider 原始字段（动作 / tool_call_id 不混流）。
        self.assertEqual(
            {
                "stream_id",
                "idempotency_key",
                "sequence_no",
                "content",
                "review_evidence",
            },
            set(chunk),
        )

    def test_chunk_idempotency_keys_are_deterministic_per_sequence(self) -> None:
        first = _former()
        second = _former()
        text = "键" * (CHUNK_WINDOW + 1)

        first_chunks = first.feed(text) + first.finish()[0]
        second_chunks = second.feed(text) + second.finish()[0]

        self.assertEqual(
            [chunk["idempotency_key"] for chunk in first_chunks],
            [chunk["idempotency_key"] for chunk in second_chunks],
        )
        self.assertEqual(
            2, len({chunk["idempotency_key"] for chunk in first_chunks})
        )


if __name__ == "__main__":
    unittest.main()
