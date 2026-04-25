// localStorage への安全な書き込みヘルパー。
// 失敗時に握り潰さず、呼び出し側に通知してユーザーへ警告できるようにする。
//
// throttle: 同じキーに対するエラー通知は最後に表示してから 30 秒間スキップ。
// （デバウンスされた自動保存が連続失敗しても toast を連打しないため）

const lastShown = new Map<string, number>();
const THROTTLE_MS = 30_000;

export function safeSetItem(
  key: string,
  value: string,
  onError: (message: string) => void,
  label?: string
): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    const now = Date.now();
    const last = lastShown.get(key) ?? 0;
    if (now - last > THROTTLE_MS) {
      lastShown.set(key, now);
      const subject = label ?? "データ";
      const msg = `${subject}の保存に失敗しました。ブラウザの容量制限が原因の可能性があります。`;
      try {
        onError(msg);
      } catch {
        // notify 側が落ちても保存処理自体は不変。
      }
    }
    return false;
  }
}
