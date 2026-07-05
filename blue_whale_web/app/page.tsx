import PromoCapsule from "@/components/PromoCapsule";
import AgentComposer from "@/components/AgentComposer";
import QuickTags from "@/components/QuickTags";
import TemplateCards from "@/components/TemplateCards";

export default function Home() {
  return (
    <main className="relative z-[1] flex flex-col items-center min-h-screen bg-[#0a0a0a]">
      <div className="flex justify-center pt-[32px]">
        <PromoCapsule />
      </div>

      <h1 className="font-outfit text-[36px] font-semibold leading-[56px] text-center pt-0 mb-[32px] text-white">
        任意视频，告诉你的 Agent 即可创建
      </h1>

      <div className="w-full px-4 mb-10">
        <div className="w-full flex flex-col items-center">
          <AgentComposer />

          <div className="mt-3 flex w-full flex-col gap-3 max-w-[1135px]">
            <QuickTags />
            <TemplateCards />
          </div>
        </div>
      </div>
    </main>
  );
}
