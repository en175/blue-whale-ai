"use client";

import { useEffect, useState } from "react";
import { fetchTemplatePage } from "@/lib/templates";
import type { TemplateCard } from "@/types/template";
import { TemplateCardItem } from "./TemplateCardItem";

type Container = { type: "grid"; cols: string } | { type: "scroll" };

const MARKETING_CARDS: Card[] = [
  { title: "为这款产品创作一条 UGC 广告", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/-mpzxI3neDx6RPHe.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/FE_KPAFDu3_1pSmz.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/5xZj1ipYwfJ2Jqc_.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/G_FZ4A6ZT9P22LMm.webp"] },
  { title: "批量制作 10 条 UGC 带货广告", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/nsycXrxRW2m5mMlT.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/9kFOn0lb6hS6iaXh.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/DLgyrYhQzEOEOlub.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/uYejUwXFI6kXmyw-.webp"] },
  { title: "复刻这条爆款产品广告", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/h-X9dnFvhDTTDBkP.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/9uePP4nYY3AgCGv_.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/6jlOXdNzAKXJuHsZ.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/v6Waw_zcXtavbM2v.webp"] },
  { title: "将商品链接制作成宣传视频", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/mLXY1VGSVMZNrH9Q.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/Zgi6Lycj1HnnrNxg.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/n0jNm5MblskBnAw5.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Cyj815TQRkO2oQNZ.webp"] },
  { title: "制作一条电影感 TVC 品牌广告", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/LjhhcvHLHgA-MVYf.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/i93ZgDkJEps7epld.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/qsmne3iarr9MWE6o.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/AyZO2JThG8uDovUL.webp"] },
  { title: "为这套穿搭创作虚拟试穿视频", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/ceFVpO2BdXf2lwHk.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/jzekLVhMO34tTkYx.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/r8Dw6RhjZM1FkCIv.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/5OWTYORTLl88jOSJ.webp"] },
  { title: "为我的餐厅制作一条介绍视频", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/rcZ2ANm3UZ-pIjbZ.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/UX1Wpr8ewZNJCQT6.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/TzaJpgmaMpXCx4RG.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/iwok04AOcwZw7buj.webp"] },
  { title: "围绕我的产品讲述创意迷你故事", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/_9_KDNonFOJHeGXC.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/_zApAwlJrwvOAcPZ.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/axJySYoruc-wE6OR.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/sKmP5bOxwRd56yTz.webp"] },
];

const SHORT_CARDS: Card[] = [
  { title: "创作一条科幻微短片", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/SUhCgSY7gkCnASIb.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/QMzRjaueg94jFAKd.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/1X7kMpevz2YUmFEG.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/zaFT3jymqL21n5PR.webp"] },
  { title: "写一个复仇戏剧场景", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/xb5YzCSguqTuh6mv.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/oobUck_dyMQGtO_h.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/TiiebwCiUmRrETmc.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/IU__VZglonHTjH16.webp"] },
  { title: "制作一段电影感打斗镜头", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/G0-IA_s5rcnfnQWm.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/cB3I6Weje7xb3a6Q.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/IjVSkcC14UB9MXDn.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/J1RBgGJwK24W6obb.webp"] },
  { title: "创作一个动漫故事场景", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/etuKTal_Ap5LZxAp.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/698jiFEfkUdZgpqL.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/fKPnoSmGI4z4_OTK.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/IU9FQa4VABQy0es8.webp"] },
  { title: "制作睡前故事卡通片", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/FwgACxWJV8rKzH5C.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/PT2ditJYpti1P0Du.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Q5tevhddZtl8VQdR.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/N1z9HPHJGPWPUgCI.webp"] },
  { title: "创作游戏概念 CG 预告片", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/MuDl8MaS470FRK1g.mp4", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/5oKg1UXaJ2Z4nM6u.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/m2VCC3H1hEDCLWgV.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Ct2YsBZo_HYSuDE5.webp"] },
];

const REPLICATE_CARDS: Card[] = [
  { title: "复刻这条爆款产品广告", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/h-X9dnFvhDTTDBkP.mp4", layout: "portrait", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/9uePP4nYY3AgCGv_.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/6jlOXdNzAKXJuHsZ.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/v6Waw_zcXtavbM2v.webp"] },
  { title: "匹配这条视频的画面风格", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/HLGLWgAHa1iB32mA.mp4", layout: "portrait", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/z6M6FSvwOkHmYQEh.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/9_FUvk0EAmifE-tM.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/yxESD9bh9KPi0UvK.webp"] },
  { title: "复用这条视频的脚本结构", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/4wVEAaW2mHt-HAB2.mp4", layout: "portrait", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/mlIaIO5R2bBtKRsS.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/vvLPWoQ0lXsussRR.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/qVVR_FIiL4Ho-sxl.webp"] },
  { title: "制作日语版本", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/UMj9H3kjcdsAKI_z.mp4", layout: "portrait", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/lVijg7xe9t2sXxyN.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/rWdXNaQbrD3hgKwL.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Da6wr0YzPylzzdwM.webp"] },
  { title: "替换视频中的人物", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/rsO3wYxttdXIPaZR.mp4", layout: "portrait", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/GEGnzOxq2o4BrkCd.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/da1miHOzrNT8F3XJ.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/NWm29zo0ikTYFlvS.webp"] },
  { title: "将卡通转为真人实拍", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/JbC_kdA6Vi3y98Tt.mp4", layout: "portrait", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/nvyICkcksVoJOLdw.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/TEzXSRur0lRYzX_L.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/T2_E806YADXpCbgX.webp"] },
];

const SOCIAL_CARDS: Card[] = [
  { title: "制作魔法变装过渡视频", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/6GL-uzfBX964bCGL.mp4", layout: "social", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/QSw9ImK22KG9sXW4.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/s5VbfuAiZPkW5lA1.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Rf2-yJXjx2gyAwKm.webp"] },
  { title: "创作精致生活 vlog", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/SKIHQUzxA5j4GXAw.mp4", layout: "social", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/8Whi6pO7JSc3wJ28.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Cod28Krz-QPfM4yX.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/goniNlyRVWrButw6.webp"] },
  { title: "生成播客讨论片段", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/MMsWQ3wk1T5MkPCg.mp4", layout: "social", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/2mhTuNW0qSurovSs.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/xORgW-O0IVNg7q85.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/2mhTuNW0qSurovSs.webp"] },
  { title: "用视觉方式讲解概念", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/gKEPjwIurn7zaxDT.mp4", layout: "social", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/lY4r8HnncvG-JPbf.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/VqAxXPxzhMJbgZOs.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/nKo-wn5RR9K3i5Tm.webp"] },
  { title: "让我的宠物表演技能", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/BSObfzWakPHAufBw.mp4", layout: "social", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/sF_29b3xmUMUc4Ok.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/cOV-n2-wGYcghVfF.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/FBdAP7rRuge74fAW.webp"] },
  { title: "制作搞笑短视频", video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/6P2l5OiSxdVt6ZNg.mp4", layout: "social", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/b1or-eReUFoTl7Qg.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/-ypogTE-7BGyqNnv.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/QCVDx08bltQWls-P.webp"] },
];

const IMAGE_CARDS: Card[] = [
  { title: "设计高级产品主图", layout: "image", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/Y7Ryu1R1dSdJU2Dx.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/LSt66iNTvPa_ipyk.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/prwLhlnCmgiur42e.webp"] },
  { title: "制作商品详情页", layout: "image", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/xXyrFPyISEKtmR2b.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Ed-JQeCGSqMH98ua.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/VCMgO0HQJWY4VTnL.webp"] },
  { title: "设计营销活动海报", layout: "image", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/4VrENnbmYOWTAEfS.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Jt_GpabYZpePnhA4.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Nobu4qir_1GgQa6G.webp"] },
  { title: "设计 YouTube 缩略图", layout: "image", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/Zuj-C-X3v-zM2Ww7.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/QkEm2g7fufauhHJm.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/_P1N5XPE6fSOyAUA.webp"] },
  { title: "为这款产品设计包装", layout: "image", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/56HBa0ScjFVdL317.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/yCYWs2CuApdRla-8.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/hQo30udvYe_zOVOL.webp"] },
  { title: "创作现代品牌 logo", layout: "image", images: ["https://dj5nb01yl89hl.cloudfront.net/media/images/xEPEqZnU1gZoAVHx.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/Hy89VuSzZW12qIJQ.webp", "https://dj5nb01yl89hl.cloudfront.net/media/images/_Y4JcvCCrrkZD5SF.webp"] },
];

const TAG_CONFIG: Record<string, { cards: Card[]; container: Container; wrapMaxWidth: string }> = {
  marketing: { cards: MARKETING_CARDS, container: { type: "grid", cols: "md:grid-cols-4" }, wrapMaxWidth: "max-w-[1135px]" },
  short: { cards: SHORT_CARDS, container: { type: "grid", cols: "md:grid-cols-3" }, wrapMaxWidth: "max-w-[848px]" },
  replicate: { cards: REPLICATE_CARDS, container: { type: "grid", cols: "md:grid-cols-3" }, wrapMaxWidth: "max-w-[848px]" },
  social: { cards: SOCIAL_CARDS, container: { type: "scroll" }, wrapMaxWidth: "" },
  image: { cards: IMAGE_CARDS, container: { type: "grid", cols: "md:grid-cols-3" }, wrapMaxWidth: "max-w-[848px]" },
};

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-[4/5] animate-pulse rounded-xl bg-white/[0.04]" />
      ))}
    </div>
  );
}

export { TAG_CONFIG };
export default function TemplateCards({ activeTag }: { activeTag: string }) {
  const [cards, setCards] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTemplatePage(activeTag, 1, 50)
      .then((page) => {
        if (cancelled) return;
        setCards(page.records);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载失败");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTag]);

  const container = TAG_LAYOUT[activeTag] ?? TAG_LAYOUT.marketing;

  if (loading) {
    return <Skeleton />;
  }

  if (error || cards.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center text-sm text-white/60">
        {error ?? "暂无模板"}
      </div>
    );
  }

  if (container.type === "scroll") {
    return (
      <div className="ncs-thin-scrollbar -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 pb-1">
        <div className="flex w-max min-w-full justify-center gap-3">
          {cards.map((card, idx) => (
            <TemplateCardItem key={`${activeTag}-${idx}`} card={card} index={idx} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-3 ${container.cols}`}>
      {cards.map((card, idx) => (
        <TemplateCardItem key={`${activeTag}-${idx}`} card={card} index={idx} />
      ))}
    </div>
  );
}
