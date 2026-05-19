// 最近開いたプロジェクト ID を localStorage に保存するヘルパ。
// prefetchAudio.ts と組み合わせて「次に開く可能性が高い曲を先取り download」するために使う。
//
// 保存形式: ["projectId1", "projectId2", ...] 新しい順、最大 RECENT_MAX 件
// 同じ id は最新位置に移動（重複は持たない）

const KEY = "telop-recent-projects";
const RECENT_MAX = 10;

export function getRecentProjectIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentProject(id: string): void {
  if (!id) return;
  try {
    const current = getRecentProjectIds();
    const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage 容量フルなど。本番進行に影響しないので silent skip。
  }
}

export function loadPinnedProjectIds(): Set<string> {
  try {
    const raw = localStorage.getItem("telop-pinned");
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}
