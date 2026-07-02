"use client";

import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  BookMarked,
  Check,
  ChevronDown,
  Ellipsis,
  FileText,
  FileUp,
  Search,
  SquarePen,
  Store,
  Users,
  WandSparkles,
  X,
} from "lucide-react";

interface MySkill {
  id: string;
  title: string;
  description: string;
  cover: string;
}

interface LibrarySkill {
  id: string;
  title: string;
  description: string;
  cover: string;
  usage: string;
  contributor: string;
  added: boolean;
}

const MY_SKILLS: MySkill[] = [
  {
    id: "brand-design-system",
    title: "Brand Design System",
    description: "Tell it what your brand stands for, it designs the complete visual identity system. Analyzes brand positioning, personality, audience, and competitive landscape, then auto-generates production-ready brand guidelines with complete logo direction, color systems, typography, visual elements, layout grids, photography style, and application specs. Also outputs AI image generation prompts for every visual asset. Not a design template collection -- a brand strategist and designer that thinks for you.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1782705006808-u27kk3.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MjcwNTAwNjgwOC11MjdrazMucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=Titufvzy6VR0QyrnJml0LwMnV4fSQw7Cpbg4ZSf-nSwkx-iA6muXWKL5Jgx915gxCyS38fUS92W2FRv29m4G32a5poIdWFGaAN1tU4e~JbMf8PY322HtvaE1B20k6Oxotg2ayYrLJeTZ2qj47VKzrQyODPJvCqp0TQG0~5djN-yh5W0aZgUNhQwbzqCUl~b7NDWh0R~gssZzjKIsKzwNb-TufxkVwryhZa79rU2GQXd7odBawCdLf91qALHgbEN8MQfOViFz2H0~nHaf05jI0J-EN-ViFjn28wdb6tBgJY5fQZfWFkbUa3GuPSyAou9W~LnTxHjG82s9XNpaCYF9tg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "fast-product-demo-video",
    title: "Fast Product Demo Video",
    description: "Create fast-paced product demo videos that show a product through quick close-ups, hands-on use, and real-life proof. Use when the video should feel energetic, easy to understand, and focused on visible product action.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781503740183-e6boly.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTUwMzc0MDE4My1lNmJvbHkucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=CUvLXbMMJPK5QWGEkpS~~NuPbhljtigK1eiQ21NycjmClkByzQHAsdEDTFbgxBhcvKu1JovAVH4vxuoczteb7OxOUhQgo~jOF07xUc7vg4V5tgnBAloqzKnj~8Oyt5lsGY0kPUSHePpK6FQhqLWkpjoHr-50DeR0d8fgaoH9vOs0jPDfeHECznsuCt1RlMoF8vyDM0CjWx5-5sBHLb9RYCNbEMab-qpQEoQppOxo8U31BQ6FT5cQA0Q~w8q2Zqyp5d14Fz4CK30SW3UJ71wesZ5wr9SZWTSc1ivm~V4nJE-rEj3R~C4oNj02aAxHmsf22TjsjzP5jXKY6f~quAmcQg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "tvc-product-ad",
    title: "TVC Product Ad",
    description: "Official custom skill for TVC-style product advertising. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when an e-commerce product video should feel like a polished TV commercial with premium lighting, controlled camera language, brand voice, and clear product payoff.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781365436999-sr909r.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM2NTQzNjk5OS1zcjkwOXIucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=ZoPPMICShoQ2i9I9R-zX84jz4Tm8KS0y34w19lynclK4vfQ469NdKD9Sx8gfDpv-xcFRhbw94LnugEkOLyISq8y6T6eRPm1hWXdBjTnUvw4u8CW~RN2FCRKhOQZ5NEK0GR37RWHgt~AVZbKBZYVu-z6KT3NPzdA7gXrzfvI1EFB0COn6ubQLASvT9noWtIxDlxJEyknxGkPjEaDCFS40SCjoxvfqTBUU7jrSwc4pgLYEkXNrKHmef7JDUGx5esCF~BD6OTqnjGy~al1cCK8uLIZzi0Guv~CkZ8-ZMJb53-MkUyKWQTPe2PcaVB8OIGXFKixZdReHaT1DE4YSN1eIlQ__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "interview-product-ad",
    title: "Interview Product Ad",
    description: "Official custom skill for interview-format product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should use street interview, podcast interview, conference interview, multi-conversation, TV-show, or playful animal-interview formats.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359565864-xt5a4f.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM1OTU2NTg2NC14dDVhNGYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=llT06v6QSwA6K2~cSTqQIjqymcb7ztyvFElMakkHZ9-Emz9uOvSKkwHLp8k0vtOniJiGMXR7dOEqki2ZOsqsXjvqLyk8jTmMIHuoxxnLTWxkfeqEGOb4omoglcuB5VSha90h11yEP08Zn3TQNVHB6bLGMUGIMMLbQH3cz1XR9B1wWGLQUTLJfHuiy1NYdepLrL6sVSCjwp60B7OLaUaJgzi5a7bdXrCAnnqolizFKbLnO4tmI48mdqmrmJ5B1703R4G6J00eTCktQK3ESebwvHhRe4FODfAN7KTfc9NCIYWVEiLL6FN1SanLb3TO3MjAlyrcttuVNc2EQcjfx-lLZA__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "master-director-camera-movement-toolkit",
    title: "Master Director Camera Movement Toolkit",
    description: "25+ signature camera movements from cinema's greatest directors across 6 schools. Each technique includes emotional function and exact prompt templates for AI video generation.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781265350537-pzqd5y.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTI2NTM1MDUzNy1wenFkNXkucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=qQhjpeZ83J1xEWU8nxEvnV5~6Gp7sf-6NqLcDuUWZla9OoVSvLAm7YJqC1Khp2MEvkG4KyktLa7p5VkLk3ZHV6UnvanN8SPwJCfn4VG0SG5Z-z9Ic0-iDXAd0NIaow5c1JH1RF5B48o1rWwOCRYC2IZQgHA7EZgzJiCP4MGPGQpVCXQAsDCw29Hty5fFaKfIXIRrG7YJGo7PzAYy2Q~mj5FNiP9OhqzX~tRjbYUJrueKGeFzw8NXxzU3nNprFyt8pr3hAF07sQXSy9vfTutMXPMHm~ppHj4p6cfNNxehsFUD5proZrf4zDpXkD-y09UJaGa6ao0vCY7URPsz9CXtGg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "talking-head-video",
    title: "Talking Head Video",
    description: "Create presenter-style talking-head videos from scripts, monologues, explainers, lessons, reviews, or sales messages. Use when spoken content needs natural delivery, believable scene design, and consistent visuals across any requested length.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781500314863-e3damb.PNG?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTUwMDMxNDg2My1lM2RhbWIuUE5HP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=cOxJSvKJPpY6GZS175l7alxJMPAI2UK~jhhI-E8xsBKo46SpLK~Qy58CHd9asq1c5NU6~xzdLFnMB~q~1am8k85bvqZpu6WLMbRft6qnJhwV0zNokTSLb4DQiP5xcnpWLvXzRpKg41B3-DouusFL-QiVFIJ~iy6bS8eSlRYSFE6CxvWLspmg6bSaMhbjTbA1qC8jDsy7uh2Sd~Ey6mKmAr5ccokby9R-GSgqPH4Wa30unEVBhAmgS6r~WHgoul7C2x4A~7ACupCiQl6N7pMpfwW2OmHLQ1CJabEHPjWOEgvyunhXdI2Ifiogo7IXvSQguj4kgBgZAEsb3wpxWkKYkw__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "overlay-product-ad",
    title: "Overlay Product Ad",
    description: "Official custom skill for overlay-driven product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should include frame design, feature callouts, product cutouts, branded CTA-style graphics, split-screen try-on, or multi-outfit styling layouts.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413141606-qsoin6.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMzE0MTYwNi1xc29pbjYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=D-0Ca~XU3tvuwXdEGAQ73qWerkC-qy0EFpv-k80KtbnS-Yp9TTn~gnhHaQhA-w~L6V0AvDBwREwbYcXfrYUjn-bm5M0uqA9mj4jiVe5MI2eiDWqDUUpYgSZonC43iX2qZfBqDbEAN-4W78xAtmpc1r0A951uzk9zHZ9tIkDXaBEZmDGqndcMCXzhoLyjH774KE8zAgim9JZyWFz09Z5q7gciyeH~Onadk~65ovdnchhv8vLI3T1XaCmG74ZF9roTuAB8X6ifhwTw-eeEl3y-Zw-csgSR-H9te~mheD1blLNY~Fe4xMN3nTrMSf~4V4FkPghwEYfDcUrBzx2xtB5QbA__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "keynote-talk-product-ad",
    title: "Keynote Talk Product Ad",
    description: "Official custom skill for keynote-style product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when a talking-head presenter should explain the product with polished stage-style delivery and supporting b-roll.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781367037823-ug8c4a.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM2NzAzNzgyMy11ZzhjNGEucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=dIn66eSPrZpoKh9InmuD~oAwR2biJfWOxvnMI8TD2xTpHhrXRYQaaezYIPswMNrf3-Qjmu-izMpNI0FwakAn38RH97Fi547b6fwUgwXLpFBj938cndE9hpnMtGTt-6cG8nypF5JQBd8IzXiwCDlakV51x6Eoa5q2A2ryXAerem7dnVFYARcLSxqf5W-fzXHnuj2ZE3BiRJEpBA~yHCtDe1FtXQgkL-iGkgq~W5DSJgHAZirkhU1eKaHLR~17MGujUVHKkrqz1b0G3uZT6nG7fj6p9wnILWfrBN--hW8~Xcbnx6jmfHKNP9JTAgDrupm1rXfjLTxjXvyM0ogPEyDVCw__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "e-commerce-product-image",
    title: "E Commerce Product Image",
    description: "Create commercial ecommerce product image prompts for uploaded product photos across main images, product detail visuals, PDP/A+ image sets, hero banners, landing-page key visuals, social feed images, stories/reels, video key visuals, sponsored ads, retargeting banners, email visuals, store POP, station posters, and custom promotional assets. Use when the user needs a product-centered ecommerce visual and the agent should route to the right image type, preserve product identity from supplied images, generate on-image copy when needed, and apply detail-page visual rules when the request is for a single product-detail module, PDP, A+ content, marketplace gallery, or detail-page image set.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781503555726-pivui6.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTUwMzU1NTcyNi1waXZ1aTYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=eZs4dwvyYqOu5Ebvsqr-UlGQCUHsnvmr4LG2fCy1QuieBkTZMFPQTnQIXtOW3cKoydX0ddzVwvwhKz0cmWzYoEjEp5tHcAPJLa~JpcqNlcQO0dfY4B4vkhfILR4SKBs2tpsFKbXraPSW7SwLs0ddei0QVMKzOx-LNWYrX6AJD6XqumEibBdc6Q7e8jpnm6P7SjDMeFPDOwzRYPzHcbCmpNO1FP8A8rQHVBfzjN43gSJStSGityqQVkT24ehoIaHMa8KmMxPutITH2gAZy5Y6WlbkcdCFebu3~14hEl5f7uItCr98T2QqGF3LpqA7twdQIQXakB1qRlO4mioDK-RTGQ__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "comparison-test-product-ad",
    title: "Comparison Test Product Ad",
    description: "Official custom skill for product comparison test videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should compare the product against an old way, generic alternative, cheaper option, premium option, or competing category choice.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359664559-h73mxf.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM1OTY2NDU1OS1oNzNteGYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=nvLrgd4SWxpJe3n4pqtNL~Fn6lID5vWOHaf9IVgqW6eTKFLsHWRKiJ4Fm3PgZrdXo2XmoY3iMe~DvHY2s0TmekOcg4CNM7CEBySxXxoY~vGS69ie1MxOHMo1zQHQuLSRpbseY6R8itJBZKYdkLY1endJaDwQZh5KJVuXQ9~BvinThKR9iMUwxnbF~MoIYT0PBHS8IAe8oUBolL35-PlpwbJsOVE6GLu2-xkjlhTyMDdLFQvHOrlyOapnjLL9PapJ~seBVbV5apamrbiQp4-VY65Kz10YF~scmhE5CwhK9ymC1KGw~b4Nzt5vWHdtR9KocpwrFlXiNPQZrCicMn1~9Q__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "social-argument-twist-video",
    title: "Social Argument Twist Video",
    description: "Create social videos where an argument or emotional conflict is interrupted by a sudden disaster, strange event, or impossible twist. Use for relationship fights, workplace conflicts, family disputes, comedy reversals, and dramatic social scenes where dialogue tension leads to a strong visual payoff.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781497084373-lptlal.JPEG?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQ5NzA4NDM3My1scHRsYWwuSlBFRz94LXByb2Nlc3M9aW1hZ2UvZm9ybWF0LHdlYnAiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3ODM5MDA3OTl9fX1dfQ__&Signature=YNNeh4b5nLqT32WPlqJ6WKqVRx1IKGDxCLpiaV6K2lLrMWro-XOPemkw7l2TWfyxbHHtNwHUyB1g5rQ1TSV6-WvQ6bWoJLZDqHSHBuSW31Xoq9cp0byTqBVkzDidqDwI8IK77Y373Vxz-vafZl97jLBzmvdDKXRqopDOhvRPNVATMhXLjuo913htfzs8kogz2RicBdjtlURndDVW1-lnan7F1HBsZhuw2pX5Fyf2-Esg65l~ruOASaF3ND~bAfoR6AhZdGIR8LE3pGsG3hep65789Gm9bYvnRr5vrW7IBYmEfrq8Ggfd6LX1TmEQXgq34Blzb-TcpPoToqqdtOgc6g__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "friend-recommendation-product-ad",
    title: "Friend Recommendation Product Ad",
    description: "Official custom skill for friend-recommendation product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should build trust through peer recommendation, friendly advice, or word-of-mouth credibility.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781358758804-ankauf.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM1ODc1ODgwNC1hbmthdWYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=E8eyk3yIzmtVqXlZmZFeaRR1ES4sDiMQ21Tc6yk6zhnDwWaRAaNdNZS3DffzdspYoDC28Brr-W6~mYHkVqz97ovwPx5wpgmH6ig52ZPIzygW2jCwhs1wyvOnt5h2hcus-ACbM03NSKZ3Uyh6~Ng9ccu-AqM1UMkEPJ3p3GpVycn7EUEuqOaHLrAQHJSKp6GjEt21xQ7EONuUCQRCZzr2-p8i5mf-iMBPsiq5KNb~mcMJeCh9UWxQDSvkXGEVKQp5U6SmYRnTSZVi~BWii497FKTJChxr9CJCtty3ya1nQzU4-18Dzit4QWWoWgqWE2LGpm--tX8zEivq1zi3bR73KA__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "ugc-ads-video",
    title: "UGC Ads Video",
    description: "Create natural UGC-style ads that help sell almost any ecommerce item by showing what it is, how it is used, why it is useful, and why viewers should care. Use for demos, creator reviews, lifestyle scenes, comparison videos, problem-solution ads, social proof clips, and longer multi-part ad videos.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781503310520-l211rd.PNG?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTUwMzMxMDUyMC1sMjExcmQuUE5HP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=gtcfj678ohmRgm54WWI9t6n3zD~WOAGHO5zbr8TJmzRIrQnpE6oZZ-KGE~WsCnvcwYiJh5rVZEzIYD3RKuReAukehFi8MK9Z-tr-FbRDHocjoRrFHwM-C9RZi~AyNpVzluXVQoj5tg-1HLYn8mJ6Bv-G2nvChwUxO4MtjShskVgC69NXM7oGEIgVTyiDJWQ16PjhlDZTjsWW5-v2Lq73eHckSHh5pcmoGcGxmMdQFU2HqUTQ1ZfB2cLS6pZxXVLtK2ChwrKHGrqqmgFyn9LFaRFlYJ5F6tk8iobHi3OFL28OV2drFrp7xAC7kAHeDK-jbR4BwcWGpuMEAxdfYLWttw__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "cinematic-corporate-storytelling-commercial-production-skill",
    title: "Cinematic Corporate Storytelling Commercial Production skill",
    description: "Guidelines for designing high-engagement, comedy-driven narrative corporate commercials. Use this skill to draft scripts, visual treatments, and editing briefs that leverage underdog dynamics, corporate chaos, and cinematic realism.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781266317082-5xgkju.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTI2NjMxNzA4Mi01eGdranUucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=MqJqxkM4oKpJ9KpNhbXaDdAgo0PICnTE~0EbY3Ujp1zvDSIQdV3Mn7OlX5Cq7eVt9j~kFbekBOfPwuPqH3JBD25m9QvHD2jd84lCNinxsU~C1RgGR2QDs988uxCQmuuA1Y39jWc~nMw9j9MGneMx94vPWyKVI0J6pVtIIUy9INlAF40I96jAgtPPWn4f8Kj2WPtqM34iHJa2L2NjUh8Ot3zFBYTR3KA9-T51lwwbL1GWTUtNBE1W4FJUDynLPyEFX-NkaaQjA34hJeDlV3xmdTWsDozogPeiNvknecFFaOsH~TmUhW3JvM0E~e~A-~URs8xx~Rtwh8vH4fsRB9LV6A__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "story-driven-product-ad",
    title: "Story-Driven Product Ad",
    description: "Official custom skill for story-driven product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should tell a short experience-based story about using the product.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413627292-kx701f.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMzYyNzI5Mi1reDcwMWYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=S10gD4YLrX2lbmj-qfMZyw3~Qa3632BzOEPAExdpK92wgnSUJJccJ-V68DxaQsUTxaLWsejzyKZinJ59AUaThd7U1wbNRe9JFazT6oj1MUInzSNAxPavruyf9MPlLLy1vVo5L4mNdNJR2p~01AKC68w6~hKHPO7q1~rkU65JYpbwiW4d~5AIN5jdp16HOw2TAA8LKYENOsJKKvbUgbeaxHI9PB9IASl4CmjmgIHuxN0tfPdc68ii1FYHAFIlKWPkHu3KwgYp6bobyCT2vLaXgjJGsCHUzVKZSsakI7MnLlOcBufwsMPnPtdmjL3CjX5R-urfFyfxqChw6aCES15JEg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "decisive-sports-moment-video",
    title: "Decisive Sports Moment Video",
    description: "Create realistic sports videos built around one decisive arena, court, field, or stadium moment. Use for soccer goals, basketball shots, football catches, badminton smashes, tennis winners, volleyball spikes, saves, sprints, crowd reactions, and other high-impact sports highlights.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781596075156-kom4xe.jpg?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTU5NjA3NTE1Ni1rb200eGUuanBnP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=EWPfHF5Rids~EisndF1JXIFWcXkpI5j3LP5wsYqTqV07sdHOA6NskxMhv-KZa61fDDSVwBrNq~YOZbV-FgXr0h~CDmA2NVpj1Vm23x4-~U6Y-aVI0LF~cUUOxGjYYpixw6X7QbP3Irh1k1nD0xK0UJ2O-Jk3Sveb2BR9wB~sJXYuytGTd3EPXOlMKwcDg8d24YYNyM231O8LQfVrAE1I~rQmhsXQA-kVTYFVXMD6ozm5YSSlP4ahA9O~wncDXtviRQNVVLsdJ~-Vdg7hmGO5QE41f0gas-FBxZVmtUUps01fYycHhE5RRuzcTG8n-C0hUeqnVm1RLmaSWdiEyrRs2Q__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "lookbook-product-ad",
    title: "Lookbook Product Ad",
    description: "Official custom skill for fashion lookbook product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when a single model should showcase one outfit or product look across different locations for a one-look-many-vibes structure.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781412854034-dg9dj7.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMjg1NDAzNC1kZzlkajcucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=e8oTCDdgOFEwBA2Ux0GHwaIBAzXOPlKtxQEERUPQ~hvZMOC~8J0X5GOkswQ7eItwA112f7Gr4p4EaADkXiMcqUvZckSqd-WHMUYQwv07dVkKnSl4-LRkCG5FhOiVG2ZYRpvoEdLHP4oGPd6iJ3EeUbtLgtldklCq6cboCMo5i4dBi7Vj58KvK2Jk-9uMyGKag58EumNpWdT~tJvH3GcVAj8exjKQ5YzGd7roMM5vGZ4KvluavCDxtppn4zHeZthTaxsLA6XbSqvEvrRGJnUYzlzlE74kNfNCs2ctuHHHl6ulWLlc52CYpazaAryag1Fe-kTEJZjWHox7NQubYkSCcg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "pov-walk-and-talk-product-ad",
    title: "POV Walk And Talk Product Ad",
    description: "Official custom skill for POV walk-and-talk product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should follow a first-person or creator-style walk-through across multiple locations.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781366926717-yrcues.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM2NjkyNjcxNy15cmN1ZXMucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=CZ81076FgOnLyRBeqLV6z95jOIfTtO~686InefkBdI7IoWRBgU98-xS42uJsLJR2U-fQWvyTc-dGUaijv~s2Khf7dOJ7E1hYdpY38Y7aZYjRB1VBjlCiznpZNgk1UQLUMGVjiYANI28mz9ct-nZKFDC9aIADu7ZcAiAy6Szz7kZmeD9pNm0ueBMwTYwz4U-DqmJvbKgxU3Bx6QbLWwtbEOvkBPXtZug29p2PTlVrPDlpQcLbkCeS9BzfwhlZeO9CFFSwN4RsqGHBhSJf1dKoh8D~FYigsCpJETq56knLVs6drRXcwRemq-6RvL3Ix8YIFHm5aTIV1XLTygKvODI-rg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "conceptual-visual-corporate-promo-creator",
    title: "Conceptual Visual Corporate Promo Creator",
    description: "Guidelines for producing high-end, minimalist conceptual visual corporate promos based on principles of reduction, symmetry, and rhythmic tension. Use when designing premium brand manifestos or product launch visuals.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781266280437-caaqul.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTI2NjI4MDQzNy1jYWFxdWwucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=uXWbt6Rn5wQBJpSMKIiroFAq3cVlw46i2wb1OMqK9R70x5P5eCNoWBEB1a4Cu24n2rxx4MVF3dnf~tiv-foknDuzTW5JzEx-x7f90zybmasZDWnQgKedwqsRDHsuwxuDAHPKsAeZpN8L2LdOCdQUYyTOdXY~u4Odvi9uQ1-BWLYrC~nUeF~7bxIz69VHYCYxhJWgs6DeyBdO5xhLX43ypCCYtXgCcXZDZBeEnuJ1X1vWz2szyAlPdLFASJxypaSNaNShXTBYyRtSTfBxmPgjoX88pVHomgsIu1yy2OmD61ix~4bZswZ7VJ6cnwIGXlSck3fgAW6JrFeqLryAIBI8EA__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "pain-point-product-ad",
    title: "Pain Point Product Ad",
    description: "Official custom skill for pain-point product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should introduce a concrete customer frustration before positioning the product as the solution.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359305410-15y0x8.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM1OTMwNTQxMC0xNXkweDgucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=BjvDWoXXh95F8Em0iJGQhoLinDFT4mgjItjcvE9jRfHNaxrR2WzKFLHeFruaN~W5z2ICqQHzaDUIEwjFNoQ56llU7mjWesILcExIwf4OkTSPMtEJhj8s3ZmVxDfdj3jwKeWX9v65gILtsWwDp55nBMuYKQQWXp-8tbHZ450HBVaYx2SftHd0VSeMXnHDXUXPZUmsh7mkBz15IVOZaA~xbAR86MqOr06CkxKqU2y~LE4oqI6oPeUOLt87HpCCPv7iKbTkLbokHMeaDLf72~gYpR5GrWi3xQ2lS1kHVBKlHXzJeOzvOywKSIkm-9H3ldTmShUIo5B5Hvq7Cp6EDh~KSw__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "before-and-after-product-ad",
    title: "Before And After Product Ad",
    description: "Official custom skill for before-and-after product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should show a clear journey from an initial state to an improved result after using the product.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781358439338-d8bpqv.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM1ODQzOTMzOC1kOGJwcXYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=NNTNP9coqkl7vjRsApWix9JN3JAYM1-JFeQrAEmEosivt41WfMF3E-tOOhLTNbXJp0t7VBddypycGyZ0WvAMsKa2yJcKOxSJ2VRp8RfqfJKwy9UG7LaD80on0dBwg~lzaw741ddQIHLjTyOkltG2UrYk8wpkuce7CMW3gHGJg~mZiPEMyrxT8PJVZbvlMZiD6zX36ERXDP3tDlk9EScXaRvNL55rAmqJSkihp32GB4DZSFgfGDTWPTtU21k3mpLLLa9ph8vYD4WEifBD86cH6UfVOAzGZTWBuUeSeShVKNQu~Z1zAEO-9VavOvEelrPdnBbPr0Gqtb3qsPUZkvkWDw__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "how-to-tutorial-product-ad",
    title: "How-To Tutorial Product Ad",
    description: "Official custom skill for how-to and tutorial product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should teach setup, application, usage steps, care instructions, styling steps, recipe steps, or a quick product walkthrough that removes buyer confusion.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781412825478-pgksjv.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMjgyNTQ3OC1wZ2tzanYucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=TPa6D1F8-t53M7OX3H6D3rRLAfeCSnIF5IDQG8-goWJWhZSty-ZWD5pvvoQCMKz8-dPPVL5XPSC8w1B4WqCX5BjdtKVfWxH-mDnRMWwVwVCkXi5KxRetPAR4yUXYIcy7Jf9c~sMcNRtNPRbf9qJHVlr3jfz3LyOhj3cpvkaEq3RH5C1q1TAROPdnqsZ~JxTDib8YTy0gay~zU63St~0wBaMgYjZFYarq-a3XotVC-qWFRG~2rZmAHKa7IU8T-BA88V~nQoNMPheHbPpx8ygBkYYruX50VO7OB1NjTa2Vsq5lCM1X6u8nvHxnkbDhO6Zg7FWtYiXRNUzzGrvZ1EoMhg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "prompt-answer-product-ad",
    title: "Prompt Answer Product Ad",
    description: "Official custom skill for prompt-answer product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when multiple characters should answer the same on-screen question about a product to build social proof and authenticity.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413398191-rucsor.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMzM5ODE5MS1ydWNzb3IucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=jwPem0M4aBn3DoSsBoyJS4F~SiCnXPVMuiv8XIAXoHjIc54vr6yc6v5uELQ3N73rsmz-7xshD2WZ722ufjbMjOInMreSQG6SYsPbJvCXbnerntwvM6eON-01wZaRcpELh6sXe9kBdTKpcCHTQx9gNUbxRpPG9rXuOhj5ff6-kL4uajSDErPZiq3h-pmoJowUkyPjVU~cqpaZtmadbS4xeyGFc5hEzxA4ifVRi8Eg8x4Plsb2-d-dCEqmVwfkNQvx2YHKVJd7kVilylC05exgUbDR4DTGhaxLsR1Fo9YmboOhyn9yO4-9vWa2nkotDcXBDTCCxxh9p9o6rh1TFJ7j8g__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "product-display-ad",
    title: "Product Display Ad",
    description: "Official custom skill for product-display ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should focus on sequential product details, features, materials, and functions without featuring human faces.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413102467-xqm5wk.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMzEwMjQ2Ny14cW01d2sucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=HBEZ6cvII03Wt55j526goH6s-RHyI8QdX4Ah4gh96V1SwwjKiVYIf1jKgOoF9rS2HI83TYK-gOcQ-7JoYSuN~O8rRzK3TAsAlBFj7anj3UKC7JB24T2f44f7XlhCJunYyYjYLVAj2Ew0pDxB7jXueYOYwuyMwpVqzF8fZ3GjWnUMAEiT6YWdmRocDHDPdzDlc3wPd0K566pL90ERuMCpRTICQ-WnK01SaftW~iXUPRGlVwRHY9V~CK2Gqw~PNAPef10vmeXQV3673VUduXeeHO-kWKEu1ZdtaLXDEbY89NRyF5yqYHelV45egzP3VPnKKs-4GcOCmHtkhhGEsgzCDQ__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "routine-integration-product-ad",
    title: "Routine Integration Product Ad",
    description: "Official custom skill for routine-integration product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should show how the product naturally fits into a morning routine, desk setup, gym bag, travel kit, kitchen flow, bedtime routine, or other daily-use sequence.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413429932-vx4uuc.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMzQyOTkzMi12eDR1dWMucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=VSZrhH1TJDe1Xfa84UgCuDtN9l-PCazwSJ7UlumCv7aIWgxN9GuEm2awt6K5sztoHEmZUYJStf1lNreCxnH7S-fyd2-cK7klVvoMh1thmZ3nwPOMTAUPW4iCe3Wol-O1Mj8Q4xRgqMd4FmlpRwdjPQxR7FsHngrWWN3QIZTJIXugUPEZhNN4~ZtfAeGYD~VeZLrHbVYGPL7KRdef7Bg7jemZSKEoVjFwnMGqJBVTd8Qzm-Ld0auCHJ4Hgf8z6O5j35CDmMUvuyOvyh5H6V8gA2fp~MOhNkEO5rVX~rJqsNEOFYfUnCqWXzc9IcrFXSi3XGB1~oeb6MZdnd9ArI3dow__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "try-on-product-ad",
    title: "Try-On Product Ad",
    description: "Official custom skill for try-on product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when models should present apparel or products through product display, vlog-style, mirror try-on, unboxing try-on, or lifestyle formats.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781366061329-zhm43u.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM2NjA2MTMyOS16aG00M3UucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=B24jWuGAY4~rSoaXJNr04wTS2fpsigZfOqB9SlgkZpwoChn0UoZ3Us9qpLUbGz3sY8ia5EKgvU-5ifmRYXgjjIbHstgW1y2RLHm4hbtnVUUNHYizrg2lt56pFxGZad5YdOGYu4vtnOZ0zgoLaMWzbEV0nFJEavo4s9pJ0y2CxWRsLzoR9bgvpISeU1qjRhv7XnisJmhE6NF2Nrmw56KqhqyW7oAbHJPBuLztZQW1-RkMHufxf6M~C5Cw0OubLNrRnB4VAgM-gxGhq-SGYvrpTCW1Lc~H2EnD-5cz4M2XP7CQcLqf2W5MDnIDo16m4K5diOgp1s5xMqD-BfFXPbG3LA__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "master-cinematic-technique-toolkit",
    title: "Master Cinematic Technique Toolkit",
    description: "Unified AI video generation skill with 11 modules covering camera movement, director signatures, transitions, temporal manipulation, spatial transitions, and 60 tested camera language techniques.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781265188860-pn9kwk.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTI2NTE4ODg2MC1wbjlrd2sucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=H3VFflIWcQO5auvK0WRSsSpqFpX3jl8~YCNhLa9bqjyH~zA9HUlTHZdZLrMYbx-9v1lGH0MIqnCJRzIoZAUDuv87E5Rg7cJaKenE8RNIm14b3XGCAe62FH-q4A2HSUTPqQDsAYbzRIWUvNqJ7JUifqZyWb0~D4~678toPgR2TsmbIa9SOjn~wOUWqbjNZIXQ4m6amkjfdQqk6RPFZwSXh6FblOm8kE7lQ4ZgUZpvoJLO1CfU3SMdGP23rEtG8aU7UW3ED55-XTLYSIQiO9xBAvW74tiK3PDcrlgiG4PXeBcMOhJUVPEITXJteT~j8nEfUcwEdrnWGyW8-zjViuusmw__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "unboxing-to-demo-product-ad",
    title: "Unboxing To Demo Product Ad",
    description: "Official custom skill for unboxing-to-demo product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should turn package opening, first impression, included items, texture, setup, and immediate use into a conversion-focused script.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781364492779-o9um9b.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM2NDQ5Mjc3OS1vOXVtOWIucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=Lw7d~2ZUl79B3RsQvPQBqFoVZAwF21zcVCc2jlJDiYd2zGPgoIT~tbZ~UcBeXoWLkHVsohMwku0~0ip3x6otT7a4fegMAOp-VVgKxC1g3nmtp1tlsj988bLzbA45nliqW2CEsrSa7V1wxYlUrHKsQNMm2nCoRN-8~rwVSmLJr00-e5PkU5poP00npbwwgTBu4YFvpp4IHA4dLKy8lYV8RB-3XaXZi7is6atSUppLvD9QIhgq8MvAvVNj4pYpMiSPRZGUtFvMvT3gnWxVzr2lsLdTxnu6o2KySIumhjY-G4CABFvZxSRt1atuXP1CFHe7h6vnOu-W--69dTKGRujZXA__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "close-up-product-ad",
    title: "Close-Up Product Ad",
    description: "Official custom skill for close-up product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should focus on product close-up visuals, real-life use cases, and condition-based callouts.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781359839603-ahaos8.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM1OTgzOTYwMy1haGFvczgucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=nytVFDyzyPKbuGbLfNypCY-1wK3iR2H5SwHqwFHqWuo8n73oRTn55l7Q755E2JPCrwfIHvi68X9KiUf4TeapDC1L-7swKfYmQH~0k3ojxiC4~jasf4jRpJfUXekiTnq9ljzs0Bjdx~L4czPFgP6kAXcbPrSbuWdTzyeeRtkN3eD8wVYXQY9vLHt00L8lLHwZL4A0sH3fCUhWyee31YvaNvnwUkcJDnLzijpMSmnwsDClnmBEiLxhnrERT9yf0RJy5gkQHLcKpytCgh8Jb2llTqiVRRcL5DC52VESCPfAgX8Ef4m8tsU55jfKHTeiYjS-4CJoTqJ0Pxt~hi9JQVCuMg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "aesthetic-lifestyle-b-roll-product-ad",
    title: "Aesthetic Lifestyle B-Roll Product Ad",
    description: "Official custom skill for aesthetic lifestyle b-roll product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the product should be showcased through mood-driven lifestyle visuals, product details, or try-on moments.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781358269546-xtummu.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM1ODI2OTU0Ni14dHVtbXUucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=OkWaWtrbW9uvvM5rUC-Rvz7XY-xm4dIy8imJNDlkY43A-SGMWxgzYFOWL2iWPXvqWsrRkcYV8nWylkM3~81TzxG0s37v~21bMxecK03LYRVcpouYzWZJjqDIbR8bFz8b1f5tx-i64S-rcpWJ3ImcHI~GdNzbVYDM~ZF0VjNfLnb1hhJ4sDfb3x4f1M-pfp7Fd5KtRNqBoR6UzTlmBY1UIKVmiSI0UfyEvT99~CcwXZ7yX3IzhrokOLw6ER--S2c63~IyRSsSNj9xlvRPqMlP53iEzZAJzZ7T8Wd-KoALsIogsLHq2agJeBt8-BQl8QvX9i9ZEpmYfW1S14u3C~JqLg__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "split-screen-product-ad",
    title: "Split-Screen Product Ad",
    description: "Official custom skill for split-screen product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should show the product in use and in detail through top-bottom or left-right split-screen layouts.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781363551122-co1eoq.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTM2MzU1MTEyMi1jbzFlb3EucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=c5l7kDugLoT1Solr-kEDAdfd8z67hJqCEBge3WnQTZTVzmqCkuPTdYI~3xnvINz4U060tTzVy5RXevlpngHWRdzQjZjT86e4xmY5ZUa1qZJTgb9c8f-5hUKhBXsWMP0PHgjPLtVOGTzyFkHcp~qU-4Wrv72fmOYcLqLQOseuPcuZDctSoizf8G6jGLDZWdI0Rng0jlWRMg3-udcG9ljkqoEynko3GMvXTGfUNnfOsyzPc3Dfaoan4WD7lcxGeIyTqMOkcBdFOiBtnfWaUyAGm9g8WFMHrs0tOOw0ZUP8JW-kPJihtOMoh~S1yrXxY4uhW-P7E3bVX~BH64zZ-~gHKA__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  },
  {
    id: "review-testimonial-product-ad",
    title: "Review Testimonial Product Ad",
    description: "Official custom skill for review and testimonial product videos. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should build buyer trust through customer-style reactions, review snippets, creator testimony, or social proof.",
    cover: "https://du9d8548ooqnc.cloudfront.net/template/app/canvasSkill/cover/1781413599648-hs1ilk.png?x-process=image/format,webp&Policy=eyJTdGF0ZW1lbnQiOiBbeyJSZXNvdXJjZSI6Imh0dHBzOi8vKi90ZW1wbGF0ZS9hcHAvY2FudmFzU2tpbGwvY292ZXIvMTc4MTQxMzU5OTY0OC1oczFpbGsucG5nP3gtcHJvY2Vzcz1pbWFnZS9mb3JtYXQsd2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc4MzkwMDc5OX19fV19&Signature=iGocpV3yra5ybe8ooDusetTrA10yPQPMa0AUagU2djW6n-jBdyg67aGcR6vsJLfNpT~0TVKk6aVv3uTVEgITOUfReKzXGMptlemBuRpLLDzCugZ87Ple-eVhVHX9SGCnwKX99LnxCVU77Gd07SGSG1TByG-GNB6JOKndgMJH569vtOIFI-evT~GI8pEq5Us2gY3aDiwHBirtYHnDekmHgaHZ6VSqQiAtRg6s6~cBZEVZuiojJZaxmoGSdKFQGm1xpUXm1h0o7saGxpdzpbMNA1LiPRql5n416BYAObOiWI3JwJiU~FB0gca-LAWATrCimH2a2E90oJ~dTv~vMaE2tw__&Key-Pair-Id=K1PJBMEIA4Y1WS",
  }
];

const LIBRARY_SKILLS: LibrarySkill[] = [
  {
    id: "lib-tvc-product-ad",
    title: "TVC Product Ad",
    description:
      "Official custom skill for TVC-style product advertising. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when an e-commerce product video should feel like a polished TV commercial with premium lighting, controlled camera language, brand voice, and clear product payoff.",
    cover:
      "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "16.5k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-ugc-ads-video",
    title: "UGC Ads Video",
    description:
      "Create natural UGC-style ads that help sell almost any ecommerce item by showing what it is, how it is used, why it is useful, and why viewers should care. Use for demos, creator reviews, lifestyle scenes, comparison videos, problem-solution ads, social proof clips, and longer multi-part ad videos.",
    cover:
      "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "10.5k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-master-director-camera-movement-toolkit",
    title: "Master Director Camera Movement Toolkit",
    description:
      "25+ signature camera movements from cinema's greatest directors across 6 schools. Each technique includes emotional function and exact prompt templates for AI video generation.",
    cover:
      "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "722",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-master-cinematic-technique-toolkit",
    title: "Master Cinematic Technique Toolkit",
    description:
      "Unified AI video generation skill with 11 modules covering camera movement, director signatures, transitions, temporal manipulation, spatial transitions, and 60 tested camera language techniques.",
    cover:
      "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "1.8k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-pain-point-product-ad",
    title: "Pain Point Product Ad",
    description:
      "Official custom skill for pain-point product ads. Use as a content-type / ad-format enhancement on top of workflow-ecommerce-product-video when the video should introduce a concrete customer frustration before positioning the product as the solution.",
    cover:
      "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "5.9k",
    contributor: "@Topview",
    added: true,
  },
  {
    id: "lib-short-form-comedy-ad-creator",
    title: "Short-form Comedy Ad Creator",
    description:
      "Guidelines for directing and scripting short-form micro-drama brand commercials that use deadpan humor, contrasting severe situations with mundane consumer anxieties to deliver a memorable product solution. Use this skill whenever the user wants to create high-impact, comedic, character-driven narrative scripts or production briefs for brand advertisements.",
    cover:
      "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill",
    usage: "83",
    contributor: "@Topview",
    added: false,
  },
];

const SKILL_MD_TEMPLATE = `--- name: my-canvas-skill description: Describe when the canvas agent should use this skill. ---  # My Canvas Skill  Use this skill when the user wants to...  ## Steps  1. Understand the user's goal. 2. Check the canvas context. 3. Take the smallest useful action. `;

interface SkillPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onUseSkill: (title: string) => void;
}

export default function SkillPanel({
  isOpen,
  onClose,
  onUseSkill,
}: SkillPanelProps) {
  const [activeTab, setActiveTab] = useState<"my" | "library" | "create">("my");
  const [autoIds, setAutoIds] = useState<Set<string>>(
    () => new Set(MY_SKILLS.map((s) => s.id))
  );
  const [addedIds, setAddedIds] = useState<Set<string>>(
    () => new Set(LIBRARY_SKILLS.filter((s) => s.added).map((s) => s.id))
  );
  const [search, setSearch] = useState("");
  const [createMode, setCreateMode] = useState<"write" | "upload">("write");
  const [skillMd, setSkillMd] = useState(SKILL_MD_TEMPLATE);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleAuto = (id: string) => {
    setAutoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAdded = (id: string) => {
    setAddedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tabBtn = (
    tab: "my" | "library" | "create",
    Icon: React.ComponentType<{ size?: number; className?: string }>,
    label: string
  ) => {
    const selected = activeTab === tab;
    return (
      <button
        key={tab}
        type="button"
        className={`tc-agent-skill-panel__tab inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium rounded-lg transition-colors duration-150 ${
          selected
            ? "tc-agent-skill-panel__tab--selected text-white/95"
            : "text-white/45 hover:text-white/70 hover:bg-white/[0.05]"
        }`}
        role="tab"
        aria-selected={selected}
        onClick={() => setActiveTab(tab)}
      >
        <span className="tc-agent-skill-panel__tab-icon">
          <Icon size={14} />
        </span>
        <span className="tc-agent-skill-panel__tab-label">{label}</span>
      </button>
    );
  };

  return (
    <div
      className="tc-agent-skill-modal-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        id="home-canvas-skill-panel"
        className="tc-agent-skill-panel bg-[#141414] border border-white/[0.12] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[calc(100vw-56px)] max-w-[1440px] h-[calc(100vh-56px)] max-h-[920px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-label="Skills"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tc-agent-skill-panel__header flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
          <div
            className="tc-agent-skill-panel__tabs flex items-center gap-1"
            role="tablist"
            aria-label="Skill 视图"
          >
            {tabBtn("my", BookMarked, "我的 Skills")}
            {tabBtn("library", Store, "Skill 库")}
            {tabBtn("create", SquarePen, "创建 Skill")}
          </div>
          <button
            type="button"
            className="tc-agent-skill-panel__icon-btn inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors duration-150"
            aria-label="关闭 Skills"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {activeTab === "my" && (
          <div className="tc-agent-skill-panel__content flex flex-col flex-1 min-h-0 overflow-y-auto bg-[#141414] pt-4 px-[18px] pb-5">
            <div className="tc-agent-skill-panel__section">
              <div className="tc-agent-skill-panel__section-list grid grid-cols-2 gap-3">
                {MY_SKILLS.map((skill) => (
                  <MySkillRow
                    key={skill.id}
                    skill={skill}
                    auto={autoIds.has(skill.id)}
                    onToggleAuto={() => toggleAuto(skill.id)}
                    onUse={() => onUseSkill(skill.title)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "library" && (
          <LibraryContent
            skills={LIBRARY_SKILLS}
            addedIds={addedIds}
            search={search}
            setSearch={setSearch}
            onUse={onUseSkill}
            onToggleAdded={toggleAdded}
          />
        )}

        {activeTab === "create" && (
          <CreateSkillContent
            mode={createMode}
            setMode={setCreateMode}
            skillMd={skillMd}
            setSkillMd={setSkillMd}
          />
        )}

      </div>
    </div>
  );
}

function MySkillRow({
  skill,
  auto,
  onToggleAuto,
  onUse,
}: {
  skill: MySkill;
  auto: boolean;
  onToggleAuto: () => void;
  onUse: () => void;
}) {
  return (
    <div
      className={`tc-agent-skill-row ${
        auto ? "tc-agent-skill-row--checked " : ""
      }tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] transition-colors duration-150 hover:bg-white/[0.05]`}
    >
      <span
        className="tc-agent-skill-row__cover w-full h-full rounded-lg bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url("${skill.cover}")` }}
        aria-hidden="true"
      />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 truncate">
              {skill.title}
            </span>
          </span>
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed">
            {skill.description}
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto">
          <span className="tc-agent-skill-row__quick-actions flex items-center gap-2">
            <UseButton onClick={onUse} />
            <button
              type="button"
              className="tc-agent-skill-row__switch"
              role="switch"
              aria-checked={auto}
              aria-label={`关闭自动应用： ${skill.title}`}
              aria-busy="false"
              data-tooltip="开启后，Agent 会在合适时机自动应用此 Skill。"
              onClick={onToggleAuto}
            >
              <span className="tc-agent-skill-row__switch-label">自动</span>
              <span className="tc-agent-skill-row__switch-thumb" aria-hidden="true" />
            </button>
          </span>
          <span className="tc-agent-skill-row__more-wrap ml-auto">
            <MoreButton label={`${skill.title} 的更多选项`} />
          </span>
        </span>
      </div>
    </div>
  );
}

function LibraryContent({
  skills,
  addedIds,
  search,
  setSearch,
  onUse,
  onToggleAdded,
}: {
  skills: LibrarySkill[];
  addedIds: Set<string>;
  search: string;
  setSearch: (v: string) => void;
  onUse: (title: string) => void;
  onToggleAdded: (id: string) => void;
}) {
  return (
    <div className="tc-agent-skill-panel__content tc-agent-skill-panel__content--store flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="tc-agent-skill-panel__library-tools flex items-center gap-3 p-4 border-b border-white/[0.08]">
        <div className="tc-agent-skill-panel__search-group flex flex-1 items-center gap-2">
          <label className="tc-agent-skill-panel__search flex flex-1 items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-2 border border-white/[0.06]">
            <Search size={14} className="text-white/40" />
            <input
              type="text"
              className="bg-transparent outline-none text-[13px] text-white/90 placeholder:text-white/30 w-full"
              placeholder="搜索 Skills"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="tc-agent-skill-panel__search-submit h-8 px-3 text-[13px] font-medium text-white/80 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] transition-colors"
          >
            搜索
          </button>
        </div>
        <div className="tc-agent-skill-panel__sort">
          <button
            type="button"
            className="tc-agent-skill-panel__sort-trigger inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-white/70 rounded-lg border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
            aria-label="排序 Skills"
            aria-expanded="false"
            aria-haspopup="menu"
          >
            <span className="tc-agent-skill-panel__sort-label">排序</span>
            <span className="tc-agent-skill-panel__sort-value text-white/90">精选</span>
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      <div className="tc-agent-skill-panel__store-scroll flex-1 overflow-y-auto p-4">
        <div className="tc-agent-skill-panel__store-grid grid grid-cols-2 gap-3">
          {skills.map((skill) => (
            <LibrarySkillRow
              key={skill.id}
              skill={skill}
              added={addedIds.has(skill.id)}
              onUse={() => onUse(skill.title)}
              onToggleAdded={() => onToggleAdded(skill.id)}
            />
          ))}
        </div>
        <div
          className="tc-agent-skill-panel__load-more-sentinel h-4"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function LibrarySkillRow({
  skill,
  added,
  onUse,
  onToggleAdded,
}: {
  skill: LibrarySkill;
  added: boolean;
  onUse: () => void;
  onToggleAdded: () => void;
}) {
  return (
    <div
      className={`tc-agent-skill-row tc-agent-skill-row--no-control tc-agent-skill-row--with-cover ${
        added ? "tc-agent-skill-row--checked" : ""
      } grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] hover:bg-white/[0.05] transition-colors`}
    >
      <span
        className="tc-agent-skill-row__cover w-full h-full rounded-lg bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url("${skill.cover}")` }}
        aria-hidden="true"
      />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 line-clamp-1">
              {skill.title}
            </span>
          </span>
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed">
            {skill.description}
          </span>
          <span className="tc-agent-skill-row__library-meta flex items-center gap-3 mt-1 text-[11px] text-white/40">
            <span className="tc-agent-skill-row__usage inline-flex items-center gap-1">
              <Users size={12} />
              <span>{skill.usage}</span>
            </span>
            <span className="tc-agent-skill-row__contributor">
              {skill.contributor}
            </span>
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto">
          <UseButton onClick={onUse} />
          <button
            type="button"
            className={`tc-agent-skill-row__action h-7 px-2.5 rounded-md text-[11px] font-medium border border-white/[0.08] transition-colors ${
              added
                ? "text-white/30 cursor-not-allowed"
                : "text-white/70 hover:bg-white/[0.08] hover:text-white"
            }`}
            disabled={added}
            onClick={!added ? onToggleAdded : undefined}
          >
            {added ? "已添加" : "添加"}
          </button>
          <span className="tc-agent-skill-row__more-wrap ml-auto">
            <MoreButton label={`${skill.title} 的更多选项`} />
          </span>
        </span>
      </div>
    </div>
  );
}

function CreateSkillContent({
  mode,
  setMode,
  skillMd,
  setSkillMd,
}: {
  mode: "write" | "upload";
  setMode: (v: "write" | "upload") => void;
  skillMd: string;
  setSkillMd: (v: string) => void;
}) {
  return (
    <div className="tc-agent-skill-panel__content flex-1 min-h-0 overflow-y-auto p-4">
      <div className="tc-agent-skill-create flex flex-col gap-4">
        <div
          className="tc-agent-skill-create__mode flex items-center gap-2"
          role="tablist"
          aria-label="创建 Skill 方式"
        >
          <ModeButton
            active={mode === "write"}
            onClick={() => setMode("write")}
            icon={FileText}
            label="编写 SKILL.md"
          />
          <ModeButton
            active={mode === "upload"}
            onClick={() => setMode("upload")}
            icon={FileUp}
            label="上传 SKILL.md"
          />
        </div>
        <div className="tc-agent-skill-create__panel">
          {mode === "write" ? (
            <div className="tc-agent-skill-create__editor-wrap">
              <label className="tc-agent-skill-create__editor flex flex-col gap-2">
                <span className="text-[13px] font-medium text-white/70">
                  SKILL.md
                </span>
                <textarea
                  className="w-full h-64 bg-[#151515] border border-white/[0.08] rounded-lg p-3 text-[13px] text-white/85 leading-relaxed outline-none resize-none focus:border-white/20 placeholder:text-white/25"
                  placeholder="在此编写或粘贴 SKILL.md，需包含 name 与 description 的 frontmatter。"
                  spellCheck={false}
                  value={skillMd}
                  onChange={(e) => setSkillMd(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <div className="tc-agent-skill-create__upload-placeholder flex flex-col items-center justify-center h-64 rounded-lg border border-dashed border-white/10 text-white/40 text-sm">
              上传 SKILL.md 文件占位区
            </div>
          )}
          <div className="tc-agent-skill-panel__actions tc-agent-skill-panel__actions--right flex justify-end gap-2 mt-4">
            <button
              type="button"
              className="tc-agent-skill-panel__secondary-action inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-white/70 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition-colors"
            >
              <WandSparkles size={14} aria-hidden="true" />
              <span>AI 格式化</span>
            </button>
            <button
              type="button"
              className="tc-agent-skill-panel__primary-action inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-black bg-white rounded-lg border border-white hover:bg-[#f0f0f0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!skillMd.trim()}
            >
              <Check size={14} />
              <span>保存到我的 Skills</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`tc-agent-skill-create__mode-btn inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium rounded-lg transition-colors ${
        active
          ? "tc-agent-skill-create__mode-btn--active text-white/95"
          : "text-white/45 hover:text-white/70 hover:bg-white/[0.05]"
      }`}
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );
}

function UseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__action tc-agent-skill-row__action--use inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-white/80 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors"
      onClick={onClick}
    >
      <AtSign size={12} aria-hidden="true" />
      <span>直接使用</span>
    </button>
  );
}

function MoreButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__more inline-flex items-center justify-center w-7 h-7 rounded-md text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
      aria-label={label}
      aria-expanded="false"
    >
      <Ellipsis size={15} />
    </button>
  );
}
