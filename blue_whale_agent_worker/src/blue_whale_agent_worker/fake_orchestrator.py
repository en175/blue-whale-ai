from .contracts import (
    OrchestratorResult,
    ProposedAction,
    REQUEST_TYPE_CREATION_CLARIFICATION,
    RunWork,
    RuntimeCheckpoint,
    UserInputRequestProposal,
)

# 演示标记：用户消息以此前缀开头时，Fake 产出创作澄清提议而非生图动作。
CLARIFICATION_PREFIX = "澄清:"


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
        if work.checkpoint is not None:
            self._validate_checkpoint_identity(work)
            if work.checkpoint.opaque_payload.get("step") == "clarification_proposed":
                return self._resume_after_clarification(work, latest_user_message)
            # 其他恢复形态（如生成任务完成）保持既有行为：按最新消息推进。
        if latest_user_message.startswith(CLARIFICATION_PREFIX):
            # 创作澄清演示：缺少关键信息时提出一个可见问题，不带动作（与动作互斥）。
            topic = latest_user_message[len(CLARIFICATION_PREFIX):].strip()
            question = f"请补充你希望生成的「{topic}」的具体风格或细节。"
            return self._clarification(work, topic, question)
        topic = latest_user_message.replace("生成一张", "", 1).strip()
        if not topic:
            # 意图缺少推进生图所必需的信息：确定性地提出创作澄清（与动作互斥）。
            question = "请补充你希望生成的图片的具体风格或细节。"
            return self._clarification(work, latest_user_message, question)
        return self._image_action(work, topic)

    def _clarification(
        self, work: RunWork, topic: str, question: str
    ) -> OrchestratorResult:
        return OrchestratorResult(
            commit_id=f"fake-{work.agent_run_id}-{work.run_version}",
            visible_text=question,
            checkpoint=RuntimeCheckpoint(
                engine=work.engine,
                engine_version=work.engine_version,
                adapter_schema_version=work.adapter_schema_version,
                opaque_payload={"step": "clarification_proposed", "topic": topic},
            ),
            actions=(),
            input_request=UserInputRequestProposal(
                request_type=REQUEST_TYPE_CREATION_CLARIFICATION,
                question=question,
            ),
            usage={"input_units": 0, "output_units": 0},
        )

    def _resume_after_clarification(
        self, work: RunWork, latest_user_message: str
    ) -> OrchestratorResult:
        # 恢复原始创作流程：checkpoint 中的原始意图与本次自然语言回答共同形成动作约束。
        topic = work.checkpoint.opaque_payload["topic"]
        answer = latest_user_message.strip()
        return self._image_action(work, f"{topic}，{answer}")

    def _image_action(self, work: RunWork, prompt: str) -> OrchestratorResult:
        return OrchestratorResult(
            commit_id=f"fake-{work.agent_run_id}-{work.run_version}",
            visible_text="已接纳，正在生成图片。",
            checkpoint=RuntimeCheckpoint(
                engine=work.engine,
                engine_version=work.engine_version,
                adapter_schema_version=work.adapter_schema_version,
                opaque_payload={"step": "image_proposed", "prompt": prompt},
            ),
            actions=(
                ProposedAction(
                    action_id=f"fake-image-{work.agent_run_id}-{work.run_version}",
                    tool_id="create_image_generation_job",
                    registry_version=1,
                    arguments={"prompt": prompt, "aspect_ratio": "1:1"},
                ),
            ),
            usage={"input_units": 0, "output_units": 0},
        )

    @staticmethod
    def _validate_checkpoint_identity(work: RunWork) -> None:
        checkpoint = work.checkpoint
        if (
            checkpoint.engine != work.engine
            or checkpoint.engine_version != work.engine_version
            or checkpoint.adapter_schema_version != work.adapter_schema_version
        ):
            raise ValueError("RuntimeCheckpoint 的引擎身份与当前 AgentRun 不匹配")
