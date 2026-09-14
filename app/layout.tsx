import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { NetworkBackground } from "@/components/NetworkBackground";
import "./globals.css";

export const metadata: Metadata = {
  title: "Find · 此刻启动器",
  description: "说一句想干嘛，找附近此刻也想做这件事的人。做完即散，不留痕迹。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fffdf5",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <NetworkBackground />
        <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-9">
          <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
