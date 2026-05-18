// 本番モード（LIVE MODE）の global state。
//
// このモードが ON のとき、TELOP STUDIO は「本番現場で誤操作させない」設定に切り替わる：
//   - プロジェクト削除・名前変更・破壊的操作を全部 disabled（UI 側でガード）
//   - サーバ同期（pull / push / autoSync）を全部一時停止（ローカル断絶）
//   - 解除した瞬間に溜まっていた dirty が flush される（呼び出し側で schedulePush）
//
// 状態は localStorage に保存し、ブラウザを閉じても維持する（本番中にうっかり閉じても安全）。
// 複数ページ（home / project）で同じ state を共有するため、シンプルな subscribers pattern を採用。

import { useEffect, useState } from "react";
import { syncService } from "./syncService";

const KEY = "telop-live-mode";
type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();
let cached: boolean | null = null;

export function getLiveMode(): boolean {
  if (cached !== null) return cached;
  try {
    cached = localStorage.getItem(KEY) === "1";
  } catch {
    cached = false;
  }
  // syncService にも初期状態を反映（モジュール読み込み時点で localStorage の値を尊重）
  try { syncService.setLocalOnlyMode(cached); } catch {}
  return cached!;
}

export function setLiveMode(on: boolean): void {
  cached = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
  // syncService と連動して、サーバ同期も切り替える
  try { syncService.setLocalOnlyMode(on); } catch {}
  listeners.forEach((l) => l(on));
}

// React hook：state 変化を購読し、setter も返す。
export function useLiveMode(): [boolean, (on: boolean) => void] {
  const [state, setState] = useState<boolean>(getLiveMode);
  useEffect(() => {
    const l: Listener = (on) => setState(on);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [state, setLiveMode];
}
