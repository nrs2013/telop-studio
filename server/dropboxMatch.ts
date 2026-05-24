// Backward-compat re-export. 実装は shared/dropboxMatch.ts に移動した
// （クライアント側 fetch shim で同じロジックを使いたいので、純粋関数は shared に住む）。
export * from "../shared/dropboxMatch";
