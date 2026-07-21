import unittest
from unittest.mock import patch
import json

from blue_whale_agent_worker.http_gateway import JavaRunGateway, run_work_from_payload


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self) -> bytes:
        return b'{"code":200,"data":{}}'


class RunWorkPayloadTest(unittest.TestCase):
    def test_checkpoint_and_accepted_results_stay_product_neutral(self) -> None:
        work = run_work_from_payload(
            {
                "agent_run_id": 23,
                "project_id": 7,
                "conversation_id": 11,
                "user_id": 10,
                "run_version": 2,
                "fencing_token": 5,
                "engine": "pydantic-ai",
                "engine_version": "2.9.0",
                "adapter_schema_version": 1,
                "messages": [{"role": "user", "content": "生成一张蓝鲸海报"}],
                "checkpoint": {
                    "engine": "pydantic-ai",
                    "engine_version": "2.9.0",
                    "adapter_schema_version": 1,
                    "opaque_payload": {
                        "format": "pydantic-ai-v1",
                        "messages": [],
                        "pending_calls": [],
                    },
                },
                "accepted_results": [
                    {
                        "action_id": "pydantic-image-23-1",
                        "status": "succeeded",
                        "result": {"asset_ids": [91]},
                    }
                ],
            }
        )

        self.assertEqual("pydantic-ai", work.checkpoint.engine)
        self.assertEqual("pydantic-image-23-1", work.accepted_results[0].action_id)
        self.assertEqual({"asset_ids": [91]}, work.accepted_results[0].result)

    @patch("blue_whale_agent_worker.http_gateway.urlopen")
    def test_streaming_methods_use_java_product_api_paths(self, mocked_urlopen) -> None:
        mocked_urlopen.return_value = FakeResponse()
        gateway = JavaRunGateway("http://java.test", "worker-1", "fake")
        payload = {"stream_id": "stream-1"}

        gateway.start_assistant_message(23, payload)
        gateway.append_assistant_message_chunk(23, payload)
        gateway.complete_assistant_message(23, payload)
        gateway.commit(23, {**payload, "assistant_message_stream_id": "stream-1"})

        requests = [call.args[0] for call in mocked_urlopen.call_args_list]
        self.assertEqual(
            [
                "http://java.test/internal/agent-runs/23/assistant-messages/start",
                "http://java.test/internal/agent-runs/23/assistant-messages/chunks",
                "http://java.test/internal/agent-runs/23/assistant-messages/complete",
                "http://java.test/internal/agent-runs/23/commits",
            ],
            [request.full_url for request in requests],
        )
        self.assertEqual(
            "stream-1", json.loads(requests[-1].data)["assistant_message_stream_id"]
        )


if __name__ == "__main__":
    unittest.main()
