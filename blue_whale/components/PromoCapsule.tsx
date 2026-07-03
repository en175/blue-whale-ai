"use client";

import { Sparkles } from "lucide-react";

export default function PromoCapsule() {
  return (
    <a
      href="#"
      className="mb-5 inline-flex items-center gap-2 h-[30px] px-3 rounded-full bg-white/[0.07] border border-white/10 text-[12px] leading-none text-white/[0.78] no-underline transition-colors duration-200 hover:bg-white/10 hover:border-white/[0.16] hover:text-white/[0.92]"
    >
      <Sparkles className="w-[10px] h-[10px] shrink-0 text-white/[0.75]" />
      <span>
        <span className="text-white/[0.92] font-medium">Seedance 2.0 </span>
        <span className="text-white/[0.92] font-medium">$0.1/s</span>
        <span className="text-white/[0.55]">, Mini </span>
        <span className="text-white/[0.92] font-medium">$0.05/s</span>
        <span className="text-white/[0.55]"> ｜365 days of Unlimited </span>
        <span className="text-white/[0.92] font-medium">Seedance 2.0 Mini</span>
        <span className="text-white/[0.55]"> &amp; </span>
        <span className="text-white/[0.92] font-medium">GPT Image 2</span>
      </span>
    </a>
  );
}
