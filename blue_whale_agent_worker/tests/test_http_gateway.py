import unittest

from blue_whale_agent_worker.http_gateway import run_work_from_payload


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


if __name__ == "__main__":
    unittest.main()
