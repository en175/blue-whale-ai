/**
 * Icons —— 画布模块的自定义图标组件集合（展示层）
 * 包含 Logo、闪光/视频生成/选择等品牌图标，以及基于 mask 的 Close/Plus/Send 等通用图标。
 * 纯展示组件，除 MaskIcon 内部 useId 生成 SSR 稳定的唯一 mask id 外无业务逻辑。
 */
import { useId } from "react";

export function TopviewLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={28}
      height={28}
      viewBox="0 0 210 210"
      fill="none"
      className={className}
    >
      <path
        d="M162 0C188.51 0 210 21.4905 210 48V162C210 188.51 188.51 210 162 210H48C21.4903 210 0 188.51 0 162V48C0.000166991 21.4905 21.4904 0 48 0H162ZM161.586 69.124C161.556 69.1758 134.717 116.108 128.961 116.008C123.202 115.907 110.372 90.457 110.372 90.457C110.28 90.6044 84.343 131.966 79.5771 132.879C74.8031 133.799 74.6333 114.812 66.125 114.416C57.6174 114.013 36.9155 152.357 36.9111 152.365L46.6514 168.272L70.5635 132.722C70.5732 132.751 76.9933 152.315 89.2393 153.278C101.495 154.242 119.117 120.336 119.117 120.336C119.117 120.336 130.48 143.758 138.443 146.644C146.396 149.531 176.822 95.2796 176.911 95.1211L161.586 69.124ZM77.7305 36.3477C77.7303 52.0516 65.3453 64.9004 50.209 64.9004C65.3454 64.9004 77.7305 77.7491 77.7305 93.4531C77.7305 77.7491 90.1145 64.9004 105.251 64.9004C90.1146 64.9004 77.7306 52.0516 77.7305 36.3477Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M10 2.5H7.83333C5.96649 2.5 5.03307 2.5 4.32003 2.86331C3.69282 3.18289 3.18289 3.69282 2.86331 4.32003C2.5 5.03307 2.5 5.96649 2.5 7.83333V12.1667C2.5 14.0335 2.5 14.9669 2.86331 15.68C3.18289 16.3072 3.69282 16.8171 4.32003 17.1367C5.03307 17.5 5.96649 17.5 7.83333 17.5H12.7781C14.0706 17.5 14.7169 17.5 15.2379 17.3232C16.2194 16.9901 16.9901 16.2194 17.3232 15.2379C17.5 14.7169 17.5 14.0706 17.5 12.7781C17.5 11.9639 17.5 11.5568 17.3791 11.3022C17.1495 10.819 16.6379 10.5355 16.1065 10.5969C15.8265 10.6293 15.4813 10.845 14.7908 11.2766L12.4074 12.7662C11.4659 13.3547 10.2544 13.2796 9.39267 12.5795C8.32861 11.7149 6.77584 11.8262 5.84591 12.8336L5 13.75"
        stroke="currentColor"
        strokeOpacity={0.8}
        strokeLinecap="round"
      />
      <path
        d="M15.8088 1.37075C15.8143 1.34386 15.8528 1.34386 15.8583 1.37075C16.1435 2.76615 17.234 3.85665 18.6294 4.14186C18.6562 4.14735 18.6562 4.18577 18.6294 4.19126C17.234 4.47647 16.1435 5.56697 15.8583 6.96237C15.8528 6.98925 15.8143 6.98925 15.8088 6.96237C15.5236 5.56697 14.4331 4.47647 13.0377 4.19126C13.0109 4.18577 13.0109 4.14735 13.0377 4.14186C14.4331 3.85665 15.5236 2.76615 15.8088 1.37075Z"
        stroke="currentColor"
        strokeOpacity={0.8}
      />
      <path
        d="M7.5 7.5V7.54167"
        stroke="currentColor"
        strokeOpacity={0.8}
        strokeWidth={1.66667}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VideoGenIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M15.392 12.3211C15.3975 12.2942 15.4359 12.2942 15.4414 12.3211C15.7266 13.7165 16.8171 14.807 18.2125 15.0922C18.2394 15.0977 18.2394 15.1361 18.2125 15.1416C16.8171 15.4268 15.7266 16.5173 15.4414 17.9127C15.4359 17.9396 15.3975 17.9396 15.392 17.9127C15.1068 16.5173 14.0163 15.4268 12.6209 15.1416C12.594 15.1361 12.594 15.0977 12.6209 15.0922C14.0163 14.807 15.1068 13.7165 15.392 12.3211Z"
        stroke="currentColor"
        strokeOpacity={0.8}
      />
      <path
        d="M2.49994 7.91643V7.41643H1.99994V7.91643H2.49994ZM17.8333 10.8331C17.8333 11.1092 18.0571 11.3331 18.3333 11.3331C18.6094 11.3331 18.8333 11.1092 18.8333 10.8331H18.3333H17.8333ZM10.6249 17.9998C10.9011 17.9998 11.1249 17.7759 11.1249 17.4998C11.1249 17.2236 10.9011 16.9998 10.6249 16.9998V17.4998V17.9998ZM2.52901 7.59605L2.0366 7.68288L2.12343 8.17528L2.61583 8.08846L2.52901 7.59605Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M16.8908 5.06368L16.804 4.57128L2.44218 7.10365L2.52901 7.59605L2.61583 8.08846L16.9776 5.55609L16.8908 5.06368Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M13.4423 2.07005C13.5089 1.80207 13.3457 1.53081 13.0777 1.46418C12.8097 1.39755 12.5384 1.56078 12.4718 1.82876L12.957 1.94941L13.4423 2.07005ZM11.4816 5.8112C11.415 6.07919 11.5782 6.35045 11.8462 6.41708C12.1142 6.4837 12.3855 6.32048 12.4521 6.05249L11.9669 5.93185L11.4816 5.8112ZM8.51822 2.93829C8.58484 2.67031 8.42162 2.39905 8.15363 2.33242C7.88565 2.26579 7.61439 2.42902 7.54776 2.697L8.03299 2.81765L8.51822 2.93829ZM6.5576 6.67945C6.49097 6.94743 6.6542 7.21869 6.92218 7.28532C7.19016 7.35195 7.46142 7.18872 7.52805 6.92073L7.04282 6.80009L6.5576 6.67945Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M15.0086 1.58772L15.0954 2.08012C16.1832 1.88831 17.2205 2.61465 17.4123 3.70244L17.9047 3.61561L18.3971 3.52879C18.1094 1.89711 16.5535 0.807601 14.9218 1.09531L15.0086 1.58772Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M5.57085 3.25184L5.48403 2.75944C4.91719 2.85939 4.46735 2.93843 4.10774 3.02745C3.74375 3.11755 3.43665 3.22582 3.16207 3.40075L3.43072 3.82244L3.69937 4.24414C3.84418 4.15188 4.03357 4.07599 4.34802 3.99815C4.66683 3.91923 5.07736 3.84657 5.65768 3.74425L5.57085 3.25184Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M2.52901 7.59605L3.02141 7.50923C2.91908 6.92891 2.84695 6.51829 2.81207 6.19171C2.77767 5.86961 2.78421 5.66568 2.82137 5.49804L2.33322 5.38982L1.84508 5.2816C1.77461 5.59946 1.7779 5.92507 1.81773 6.29792C1.85707 6.66629 1.93665 7.11604 2.0366 7.68288L2.52901 7.59605ZM3.43072 3.82244L3.16207 3.40075C2.49102 3.82825 2.01729 4.50481 1.84508 5.2816L2.33322 5.38982L2.82137 5.49804C2.93618 4.98018 3.252 4.52914 3.69937 4.24414L3.43072 3.82244Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
    </svg>
  );
}

export function SelectIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M4.58594 4.58594C5.14848 4.02339 5.99097 3.84779 6.73145 4.13867L19.7314 9.24609C20.5224 9.55694 21.0311 10.3334 20.999 11.1826C20.9668 12.0321 20.4004 12.7686 19.5879 13.0186C19.5705 13.0239 19.5529 13.0288 19.5352 13.0332L14.3252 14.3252L13.0332 19.5352C13.0288 19.5529 13.0239 19.5705 13.0186 19.5879C12.7686 20.4004 12.0321 20.9668 11.1826 20.999C10.3334 21.0311 9.55694 20.5224 9.24609 19.7314L4.13867 6.73145C3.84779 5.99097 4.02339 5.14848 4.58594 4.58594ZM6.36523 5.06934C5.99509 4.92411 5.57414 5.01179 5.29297 5.29297L5.19629 5.4043C4.99309 5.67831 4.94226 6.04136 5.06934 6.36523L10.1768 19.3652C10.3128 19.7115 10.6271 19.95 10.9883 19.9932L11.1455 19.999C11.5701 19.9827 11.9375 19.7 12.0625 19.2939L13.5 13.5L19.2939 12.0625C19.6493 11.9532 19.9109 11.6583 19.9814 11.3018L19.999 11.1455C20.0131 10.7738 19.8204 10.4294 19.5068 10.2451L19.3652 10.1768L6.36523 5.06934Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function CreditIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      alt="Credits"
      width={size}
      height={size}
      draggable={false}
      src="https://d1735p3aqhycef.cloudfront.net/topview/ic_credit.svg"
      className="block shrink-0 pointer-events-none"
      style={{ opacity: 0.4 }}
    />
  );
}

export function MaskIcon({
  size = 16,
  viewBox = 24,
  maskChildren,
  ariaHidden = true,
}: {
  size?: number;
  viewBox?: number;
  maskChildren: React.ReactNode;
  ariaHidden?: boolean;
}) {
  // useId 保证 SSR 与客户端生成相同 id，避免 hydration mismatch。
  // 生成的 id 含 ":"（如 ":r0:"），作为 SVG id 属性值与 url(#...) 引用均合法。
  const id = `mask-${useId()}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      fill="none"
      aria-hidden={ariaHidden}
    >
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={viewBox} height={viewBox}>
          <rect x="0" y="0" width={viewBox} height={viewBox} fill="black" />
          {maskChildren}
        </mask>
      </defs>
      <rect x="0" y="0" width={viewBox} height={viewBox} fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

export function IconClose({ size = 16 }: { size?: number }) {
  return (
    <MaskIcon size={size} maskChildren={
      <>
        <path d="M18 6 6 18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m6 6 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    } />
  );
}

export function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <MaskIcon size={size} maskChildren={
      <>
        <path d="M5 12h14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 5v14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    } />
  );
}

export function IconSend({ size = 14 }: { size?: number }) {
  return (
    <MaskIcon size={size} maskChildren={
      <>
        <path d="M12 19V5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m5 12 7-7 7 7" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    } />
  );
}
