from .contracts import OrchestratorResult, ProposedAction, RunWork


class FakeOrchestrator:
    """用于契约测试和本地闭环的显式 Fake，不是生产默认 Adapter。"""

    def advance(self, work: RunWork) -> OrchestratorResult:
        if work.engine != "fake":
            raise ValueError("FakeOrchestrator 只能推进 engine=fake 的 AgentRun")
        latest_user_message = next(
            message["content"]
            for message in reversed(work.messages)
            if message["role"] == "user"
        )
        prompt = latest_user_message.replace("生成一张", "", 1).strip()
        return OrchestratorResult(
            commit_id=f"fake-{work.agent_run_id}-{work.run_version}",
            visible_text="已接纳，正在生成图片。",
            checkpoint={"step": "image_proposed", "prompt": prompt},
            actions=(
                ProposedAction(
                    action_id=f"fake-image-{work.agent_run_id}-{work.run_version}",
                    action_type="generate_image",
                    arguments={"prompt": prompt, "aspect_ratio": "1:1"},
                ),
            ),
            usage={"input_units": 0, "output_units": 0},
        )
