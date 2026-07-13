import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthContext";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "blue_Whale",
  description: "任意视频，告诉你的 Agent 即可创建",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-row bg-[#0a0a0a]">
        <AuthProvider>
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
