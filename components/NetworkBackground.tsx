"use client";

/**
 * 背景：荧光色块 + 人际网 + 鼠标交互
 *
 * 风格转向：从"玻璃拟态 + 虚化光晕"改成**平面撞色 + 网点纸底**。
 * 色块是实心不虚化的，边缘利落，这样才够年轻、够有劲；
 * 但色块压得很低（大面积、低饱和显示区域），保证上面的黑字和贴纸卡片依然清楚。
 *
 * 三种运动叠在一起，全部由 JS 在一个 rAF 循环里算，节点和连线永远严丝合缝：
 *   1. 漂移 drift    —— 三层各自缓慢漂浮
 *   2. 视差 parallax —— 鼠标一动，越"近"的层跟得越紧
 *   3. 排斥 repel    —— 鼠标靠近某个节点，那个节点被推开并放大
 */

import { useEffect, useRef } from "react";

type Tier = 0 | 1 | 2;
type NodeDef = {
  id: string;
  x: number;
  y: number;
  r: number;
  tier: Tier;
  /** 近景节点的填充色，远景统一用墨色 */
  fill: string;
  phase: number;
};

const INK = "#111111";

/** 每层的脾气：远层动得小、颜色淡；近层动得大、颜色艳 */
const TIERS = [
  { parallax: 8, drift: 12, opacity: 0.18, fill: INK, blur: 0 },
  { parallax: 18, drift: 16, opacity: 0.4, fill: INK, blur: 0 },
  { parallax: 32, drift: 20, opacity: 1, fill: INK, blur: 0 },
] as const;

const REPEL_RADIUS = 165;
const REPEL_PUSH = 38;
const HOVER_SCALE = 0.45;
const DRIFT_SPEED = 0.00017;

const RAW: Array<Omit<NodeDef, "phase">> = [
  // 远景
  { id: "n1", x: 120, y: 150, r: 3, tier: 0, fill: INK },
  { id: "n2", x: 300, y: 90, r: 2.6, tier: 0, fill: INK },
  { id: "n3", x: 520, y: 180, r: 3.2, tier: 0, fill: INK },
  { id: "n4", x: 760, y: 110, r: 2.8, tier: 0, fill: INK },
  { id: "n5", x: 980, y: 210, r: 3, tier: 0, fill: INK },
  { id: "n6", x: 1230, y: 140, r: 2.7, tier: 0, fill: INK },
  { id: "n7", x: 180, y: 420, r: 2.8, tier: 0, fill: INK },
  { id: "n8", x: 420, y: 520, r: 3.1, tier: 0, fill: INK },
  { id: "n9", x: 700, y: 430, r: 2.6, tier: 0, fill: INK },
  { id: "n10", x: 1010, y: 520, r: 2.9, tier: 0, fill: INK },
  { id: "n11", x: 1300, y: 430, r: 3.2, tier: 0, fill: INK },
  { id: "n12", x: 250, y: 730, r: 2.8, tier: 0, fill: INK },
  { id: "n13", x: 600, y: 800, r: 3, tier: 0, fill: INK },
  { id: "n14", x: 900, y: 770, r: 2.7, tier: 0, fill: INK },
  { id: "n15", x: 1180, y: 700, r: 3.1, tier: 0, fill: INK },
  // 中景
  { id: "n16", x: 360, y: 300, r: 5, tier: 1, fill: INK },
  { id: "n17", x: 820, y: 300, r: 4.8, tier: 1, fill: INK },
  { id: "n18", x: 1120, y: 330, r: 5.4, tier: 1, fill: INK },
  { id: "n19", x: 560, y: 620, r: 5, tier: 1, fill: INK },
  { id: "n20", x: 1000, y: 640, r: 5.2, tier: 1, fill: INK },
  { id: "n21", x: 150, y: 600, r: 4.6, tier: 1, fill: INK },
  // 近景：荧光实心 + 黑描边，画面上最跳的几个点
  { id: "n22", x: 640, y: 210, r: 9, tier: 2, fill: "#c8f135" },
  { id: "n23", x: 880, y: 470, r: 12, tier: 2, fill: "#ff5c5c" }, // 主节点：脉冲从这里扩散
  { id: "n24", x: 330, y: 560, r: 9, tier: 2, fill: "#4fb8ff" },
  { id: "n25", x: 1150, y: 560, r: 9.5, tier: 2, fill: "#ffd43b" },
];

const NODES: NodeDef[] = RAW.map((node, index) => ({
  ...node,
  phase: (index * 1.7) % (Math.PI * 2),
}));

const BY_ID = new Map(NODES.map((node) => [node.id, node]));

const EDGES: Array<[string, string]> = [
  ["n23", "n17"],
  ["n23", "n9"],
  ["n23", "n20"],
  ["n23", "n19"],
  ["n23", "n10"],
  ["n23", "n14"],
  ["n22", "n17"],
  ["n22", "n3"],
  ["n22", "n4"],
  ["n22", "n16"],
  ["n16", "n1"],
  ["n16", "n7"],
  ["n16", "n8"],
  ["n17", "n5"],
  ["n17", "n18"],
  ["n18", "n11"],
  ["n18", "n6"],
  ["n18", "n25"],
  ["n19", "n8"],
  ["n19", "n13"],
  ["n19", "n24"],
  ["n24", "n7"],
  ["n24", "n12"],
  ["n24", "n21"],
  ["n20", "n14"],
  ["n20", "n15"],
  ["n20", "n25"],
  ["n25", "n11"],
  ["n9", "n4"],
  ["n9", "n5"],
  ["n9", "n10"],
  ["n8", "n7"],
  ["n13", "n12"],
  ["n15", "n14"],
  ["n21", "n12"],
  ["n1", "n2"],
  ["n2", "n3"],
  ["n5", "n6"],
  ["n10", "n11"],
  ["n13", "n14"],
  ["n14", "n15"],
];

const HUB = BY_ID.get("n23")!;

export function NetworkBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeEls = useRef<Map<string, { g: SVGGElement; dot: SVGCircleElement }>>(new Map());
  const edgeEls = useRef<Array<{ el: SVGLineElement; a: string; b: string }>>([]);
  const hubEl = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    nodeEls.current.clear();
    svg.querySelectorAll<SVGGElement>("g[data-node]").forEach((g) => {
      const id = g.dataset.node!;
      const dot = g.querySelector<SVGCircleElement>("circle[data-dot]");
      if (dot) nodeEls.current.set(id, { g, dot });
    });

    edgeEls.current = [];
    svg.querySelectorAll<SVGLineElement>("line[data-edge]").forEach((el) => {
      const [a, b] = el.dataset.edge!.split("|");
      edgeEls.current.push({ el, a, b });
    });

    hubEl.current = svg.querySelector<SVGGElement>("g[data-pulse]");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const pointer = { x: -9999, y: -9999, inside: false };
    const smoothed = { x: 0, y: 0 };
    const positions = new Map<string, { x: number; y: number }>();
    let frame = 0;

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.inside = true;
    };
    const onPointerOut = () => {
      pointer.inside = false;
    };

    const tick = (time: number) => {
      const ctm = svg.getScreenCTM();
      let cursor = { x: -9999, y: -9999 };

      if (pointer.inside && ctm) {
        const local = new DOMPoint(pointer.x, pointer.y).matrixTransform(ctm.inverse());
        cursor = { x: local.x, y: local.y };

        const nx = (pointer.x / (window.innerWidth || 1)) * 2 - 1;
        const ny = (pointer.y / (window.innerHeight || 1)) * 2 - 1;
        smoothed.x += (nx - smoothed.x) * 0.07;
        smoothed.y += (ny - smoothed.y) * 0.07;
      } else {
        smoothed.x += (0 - smoothed.x) * 0.07;
        smoothed.y += (0 - smoothed.y) * 0.07;
      }

      rootRef.current?.style.setProperty("--mx", smoothed.x.toFixed(4));
      rootRef.current?.style.setProperty("--my", smoothed.y.toFixed(4));

      for (const node of NODES) {
        const tier = TIERS[node.tier];

        let ox = Math.sin(time * DRIFT_SPEED + node.phase) * tier.drift;
        let oy = Math.cos(time * DRIFT_SPEED * 0.82 + node.phase * 1.3) * tier.drift * 0.7;

        ox += smoothed.x * tier.parallax;
        oy += smoothed.y * tier.parallax;

        let scale = 1;
        const dx = node.x + ox - cursor.x;
        const dy = node.y + oy - cursor.y;
        const distance = Math.hypot(dx, dy);

        if (distance < REPEL_RADIUS) {
          const closeness = 1 - distance / REPEL_RADIUS;
          const push = closeness * closeness * REPEL_PUSH;
          const safe = distance || 1;
          ox += (dx / safe) * push;
          oy += (dy / safe) * push;
          scale = 1 + HOVER_SCALE * closeness;
        }

        const target = nodeEls.current.get(node.id);
        if (target) {
          target.g.setAttribute("transform", `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`);
          if (Math.abs(scale - 1) > 0.005) {
            target.dot.setAttribute("r", (node.r * scale).toFixed(2));
          } else if (target.dot.getAttribute("r") !== `${node.r}`) {
            target.dot.setAttribute("r", `${node.r}`);
          }
        }

        positions.set(node.id, { x: node.x + ox, y: node.y + oy });
      }

      for (const edge of edgeEls.current) {
        const a = positions.get(edge.a);
        const b = positions.get(edge.b);
        if (!a || !b) continue;
        edge.el.setAttribute("x1", a.x.toFixed(1));
        edge.el.setAttribute("y1", a.y.toFixed(1));
        edge.el.setAttribute("x2", b.x.toFixed(1));
        edge.el.setAttribute("y2", b.y.toFixed(1));
      }

      const hubPos = positions.get(HUB.id);
      if (hubEl.current && hubPos) {
        hubEl.current.setAttribute(
          "transform",
          `translate(${(hubPos.x - HUB.x).toFixed(2)} ${(hubPos.y - HUB.y).toFixed(2)})`,
        );
      }

      frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerOut);
    window.addEventListener("pointercancel", onPointerOut);
    frame = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("pointercancel", onPointerOut);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-paper"
    >
      {/* 网点纸底 */}
      <div className="dot-grid absolute inset-0 opacity-70" />

      {/* 荧光色块：实心、不虚化，大半探出画外，形成"被裁掉的贴纸"那种张力 */}
      <div className="drift-a absolute -left-[16%] -top-[22%] size-[54vmax]">
        <div className="blob-a size-full rounded-full bg-lime opacity-[0.55]" />
      </div>
      <div className="drift-b absolute -right-[20%] top-[-8%] size-[48vmax]">
        <div className="blob-b size-full rounded-full bg-sky opacity-[0.42]" />
      </div>
      <div className="drift-c absolute bottom-[-24%] left-[4%] size-[52vmax]">
        <div className="blob-c size-full rounded-full bg-coral opacity-[0.3]" />
      </div>
      <div className="drift-d absolute right-[6%] bottom-[-18%] size-[34vmax]">
        <div className="blob-a size-full rounded-full bg-lemon opacity-[0.45]" />
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
      >
        {/* 连线先画，节点压在上面 */}
        <g opacity={0.5}>
          {EDGES.map(([from, to], index) => {
            const a = BY_ID.get(from);
            const b = BY_ID.get(to);
            if (!a || !b) return null;
            return (
              <line
                key={`${from}-${to}`}
                data-edge={`${from}|${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={INK}
                strokeWidth={1.6}
                strokeDasharray="6 10"
                strokeLinecap="round"
                className="net-edge"
                style={{ animationDelay: `${(index % 8) * 0.4}s` }}
              />
            );
          })}
        </g>

        {/* 三层节点，位移由 JS 给 */}
        {([0, 1, 2] as const).map((tier) => (
          <g key={tier} opacity={TIERS[tier].opacity}>
            {NODES.filter((node) => node.tier === tier).map((node) => (
              <g key={node.id} data-node={node.id}>
                <circle
                  data-dot
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={node.fill}
                  stroke={tier === 2 ? INK : "none"}
                  strokeWidth={tier === 2 ? 2.5 : 0}
                />
              </g>
            ))}
          </g>
        ))}

        {/* 「此刻」：从主节点扩散的脉冲环 */}
        <g data-pulse>
          {[0, 1.4, 2.8].map((delay) => (
            <circle key={delay} cx={HUB.x} cy={HUB.y} fill="none" stroke={INK} strokeWidth={2}>
              <animate attributeName="r" from="10" to="150" dur="3.6s" begin={`${delay}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0.14;0" dur="3.6s" begin={`${delay}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      </svg>

      {/* 纸面柔光：中心留白给内容，四角压一点点，保证黑字永远清楚 */}
      <div className="absolute inset-0 bg-[radial-gradient(78%_62%_at_50%_38%,rgba(255,253,245,0.92)_38%,rgba(255,253,245,0.35)_100%)]" />
    </div>
  );
}
