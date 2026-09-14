/**
 * 全局加载态
 *
 * 为什么需要：数据库在美西、用户在国内，每次页面切换要跨国往返好几次。
 * 没有这个文件的话，服务端渲染那几秒就是一片空白——用户会以为"卡死了"。
 * 有这个之后至少能看到"正在进入"，知道程序在动。
 */

export default function Loading() {
  return (
    <div className="animate-rise flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
      <span className="grid size-14 place-items-center rounded-2xl border-2 border-ink bg-cream shadow-[3px_3px_0_#111111]">
        <span className="font-black leading-none tracking-tight text-ink text-[19px]">Find</span>
      </span>

      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-coral opacity-80" />
          <span className="relative inline-flex size-2.5 rounded-full bg-coral" />
        </span>
        <p className="text-sm font-bold text-ink/60">正在进入…</p>
      </div>

      <p className="text-xs text-ink/40">服务器在国外，第一次会慢一点</p>
    </div>
  );
}
