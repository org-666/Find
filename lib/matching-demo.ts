/**
 * 试玩模式的候选人：合成一批"附近此刻也想做同一件事"的人。
 *
 * 为什么要它：登录和真实用户还没打通，但模块 C 的匹配流程要能完整跑起来给人看。
 * 关键点是——这里只负责**造候选人**，后面跑的是 lib/matching.ts 里那套真引擎
 * （真算距离、真按时段重叠、真打分排序），不是另写一段假逻辑。
 *
 * 候选人由"我的需求"推导出来，所以不管你输入什么活动，都能找到一局，
 * 而且全部是确定性数据（没有随机数），方便测试和复现。
 */

import type { CandidateMoment } from "@/lib/matching";
import { toGrid } from "@/lib/matching";

export const DEMO_USER_ID = "demo-user";
export const DEMO_GRID = toGrid(31.23, 121.474); // 试玩时假装的"我的位置"

/** 距离档位：纬度偏移 0.001 ≈ 111 米 */
const OFFSETS: Array<{ lat: number; lng: number }> = [
  { lat: 0.0012, lng: 0.0009 }, // 约 170m
  { lat: 0.0028, lng: -0.0016 }, // 约 370m
  { lat: 0.0051, lng: 0.0034 }, // 约 680m
  { lat: 0.0106, lng: -0.0072 }, // 约 1.35km（超出默认半径，用来验证引擎会把它筛掉）
];

/** 时段偏移（分钟）：让重叠时长各不相同 */
const WINDOW_SHIFTS = [0, 20, 45, 70];

const NICKNAMES = ["阿七", "小满", "老陈", "橙子"];

/** 泛词：让后两位候选人的活动名跟我不完全一样，用来看打分排序是否合理 */
const GENERIC_BY_TAG: Record<string, string> = {
  运动: "动一动",
  吃饭: "找点吃的",
  自习: "找个人一起",
  游戏: "找个人一起",
  其他: "找个人一起",
};

export function syntheticCandidates(mine: CandidateMoment, now: number): CandidateMoment[] {
  const baseGrid = mine.grid ?? DEMO_GRID;
  const baseLat = Number(baseGrid.split(",")[0]) || 31.23;
  const baseLng = Number(baseGrid.split(",")[1]) || 121.474;
  const myMinutes = (mine.windowEnd - mine.windowStart) / 60_000;

  return OFFSETS.map((offset, index) => {
    const shiftMinutes = WINDOW_SHIFTS[index] ?? 0;
    const shiftMs = shiftMinutes * 60_000;

    return {
      momentId: `demo-moment-${index + 1}`,
      userId: `demo-peer-${index + 1}`,
      nickname: NICKNAMES[index] ?? `邻居${index + 1}`,
      activityTag: mine.activityTag,
      // 前两位活动名完全一致（高分），后两位是同类泛词（低分）
      activityDetail: index < 2 ? mine.activityDetail : GENERIC_BY_TAG[mine.activityTag] ?? "找个人一起",
      // 对方的时间窗比我的晚开始一点，这样重叠时长不会永远等于我的全长
      windowStart: now + shiftMs,
      windowEnd: now + shiftMs + Math.max(30, myMinutes / 2) * 60_000,
      grid: toGrid(baseLat + offset.lat, baseLng + offset.lng),
    };
  });
}
