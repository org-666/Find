/**
 * 品牌标记：奶油黄方块 + 黑色 Find 字标
 *
 * 之前那两个点靠拢/重合的动效虽然贴合"匹配"这件事，但太像通用科技产品的 logo 了，
 * 所以换成最直白的一版：一块奶油黄的方块，上面压黑体 Find。
 * 描边和硬投影跟全站一致（2px 黑边 + 硬投影），保证它在这套"贴纸"语言里成立。
 *
 * 方块里的字号跟着盒子尺寸走，所以同一个组件能当小图标也能当落地页大标。
 */

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? 56 : 42;
  const wordSize = box * 0.34;

  return (
    <div className="flex items-center gap-3">
      <span
        className="grid shrink-0 place-items-center rounded-2xl border-2 border-ink bg-cream shadow-[3px_3px_0_#111111]"
        style={{ width: box, height: box }}
      >
        <span
          className="font-black leading-none tracking-tight text-ink"
          style={{ fontSize: wordSize }}
        >
          Find
        </span>
      </span>

      <span className="rotate-[-1.5deg] rounded-full border-2 border-ink bg-lime px-2 py-[3px] text-[10px] font-bold tracking-[0.18em] text-ink">
        此刻启动器
      </span>
    </div>
  );
}
