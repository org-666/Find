/**
 * 模块 C 的核心：匹配引擎
 *
 * 全是纯函数（不碰数据库、不碰网络），所以：
 * - 试玩模式（免登录 + 合成候选人）跑的是同一套真引擎，不是另写一份假逻辑
 * - 单元测试能直接覆盖，不用起数据库
 * - 以后接上真实数据，只是把候选人列表换掉，引擎一行不用改
 *
 * 产品原则（来自 architecture.md）：
 * - 不展示人，只展示「XX 米内」这种模糊距离
 * - 匹配看三件事：同活动、时段重叠、够近
 */

/** 位置网格字符串格式："31.230,121.470"（经纬度各留 3 位 ≈ 100m 精度） */
export type Grid = string;

export type CandidateMoment = {
  /** 候选人这条需求的 id（内部用，不给用户看） */
  momentId: string;
  /** 候选人 id（内部用，不给用户看） */
  userId: string;
  nickname: string;
  activityTag: string;
  activityDetail: string;
  /** epoch 毫秒 */
  windowStart: number;
  windowEnd: number;
  /** 网格化后的位置；没有定位就是 null */
  grid: Grid | null;
};

/** 传出去的匹配结果：只有模糊信息，没有身份 */
export type MatchResult = {
  momentId: string;
  userId: string;
  nickname: string;
  activityTag: string;
  activityDetail: string;
  windowStart: number;
  windowEnd: number;
  /** 精确距离只在内部用于排序，界面上只能出现下面的 label */
  distanceMeters: number | null;
  /** 「300 米内」「1 公里内」这种给用户看的说法 */
  distanceLabel: string;
  overlapMinutes: number;
  score: number;
  /** 匹配理由，界面可以直接拿去渲染 */
  reasons: string[];
};

const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** 解析 "31.230,121.470"；格式不对返回 null */
export function parseGrid(grid: Grid | null | undefined): { lat: number; lng: number } | null {
  if (!grid) return null;
  const matched = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(grid.trim());
  if (!matched) return null;

  const lat = Number(matched[1]);
  const lng = Number(matched[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

/** 经纬度网格化到 100m（3 位小数），模块 A 的 location_grid 就是这个格式 */
export function toGrid(lat: number, lng: number): Grid {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** 两点距离（米）。任一网格非法则返回 null——宁可说"附近"，也不编一个数字 */
export function distanceMeters(a: Grid | null, b: Grid | null): number | null {
  const left = parseGrid(a);
  const right = parseGrid(b);
  if (!left || !right) return null;

  const dLat = toRadians(right.lat - left.lat);
  const dLng = toRadians(right.lng - left.lng);
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 对外只暴露模糊距离。
 * 有意不返回精确值——精确坐标是隐私，界面也永远不该出现米以下的精度。
 */
export function distanceLabel(meters: number | null): string {
  if (meters === null) return "附近";
  if (meters <= 200) return "200 米内";
  if (meters <= 500) return "500 米内";
  if (meters <= 1000) return "1 公里内";
  return "附近";
}

/** 两段时间的重叠分钟数（有重叠才算，否则 0） */
export function overlapMinutes(
  a: { windowStart: number; windowEnd: number },
  b: { windowStart: number; windowEnd: number },
): number {
  const start = Math.max(a.windowStart, b.windowStart);
  const end = Math.min(a.windowEnd, b.windowEnd);
  if (end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

/**
 * 活动是否相容。
 * 「打羽毛球」和「打篮球」都是运动，但不能凑一局，所以比的是 activityDetail。
 * 只有一边说了很泛的词（动一动 / 找个人一起）时才放宽到同类即可。
 */
const GENERIC_DETAILS = new Set(["动一动", "找个人一起", "找点吃的", "找个人"]);

export function activitiesCompatible(a: CandidateMoment, b: CandidateMoment): boolean {
  if (a.activityTag !== b.activityTag) return false;
  if (a.activityDetail === b.activityDetail) return true;
  return GENERIC_DETAILS.has(a.activityDetail) || GENERIC_DETAILS.has(b.activityDetail);
}

export type MatchOptions = {
  /** 超出这个距离不算匹配，默认 1.5 公里 */
  maxDistanceMeters?: number;
  /** 至少要重叠这么久，默认 15 分钟 */
  minOverlapMinutes?: number;
  /** 上限 */
  limit?: number;
};

/**
 * 从候选池里挑出能凑一局的人，按分数从高到低。
 *
 * 打分构成（都归一化到 0-1 后加权）：
 *   距离 40%  越近越高（没有定位的按 0.5 给中位分，不当成"很远"）
 *   时段 35%  重叠越久越高
 *   活动 25%  具体活动名一致给满分，只是同类给一半
 */
export function findMatches(
  mine: CandidateMoment,
  pool: CandidateMoment[],
  options: MatchOptions = {},
): MatchResult[] {
  const {
    maxDistanceMeters = 1500,
    minOverlapMinutes = 15,
    limit = 20,
  } = options;

  const results: MatchResult[] = [];

  for (const other of pool) {
    if (other.userId === mine.userId || other.momentId === mine.momentId) continue;
    if (!activitiesCompatible(mine, other)) continue;

    const overlap = overlapMinutes(mine, other);
    if (overlap < minOverlapMinutes) continue;

    const meters = distanceMeters(mine.grid, other.grid);
    if (meters !== null && meters > maxDistanceMeters) continue;

    const distanceScore = meters === null ? 0.5 : Math.max(0, 1 - meters / maxDistanceMeters);
    const overlapScore = Math.min(1, overlap / 120);
    const activityScore = mine.activityDetail === other.activityDetail ? 1 : 0.5;

    const score = distanceScore * 0.4 + overlapScore * 0.35 + activityScore * 0.25;

    const reasons: string[] = [`${distanceLabel(meters)}`];
    if (mine.activityDetail === other.activityDetail) {
      reasons.push(`也想${other.activityDetail}`);
    } else {
      reasons.push(`同类活动（${other.activityTag}）`);
    }
    reasons.push(`时段重叠 ${overlap} 分钟`);

    results.push({
      momentId: other.momentId,
      userId: other.userId,
      nickname: other.nickname,
      activityTag: other.activityTag,
      activityDetail: other.activityDetail,
      windowStart: other.windowStart,
      windowEnd: other.windowEnd,
      distanceMeters: meters,
      distanceLabel: distanceLabel(meters),
      overlapMinutes: overlap,
      score: Number(score.toFixed(4)),
      reasons,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/** 把匹配结果变成一句给用户看的进度文案（不出现人名） */
export function matchSummary(result: MatchResult): string {
  return `找到一个 ${result.distanceLabel}、时段重叠 ${result.overlapMinutes} 分钟的人`;
}
