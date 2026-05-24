import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installDropboxFetchShim } from "./lib/dropboxFetch";

// サーバ無し環境（GitHub Pages 等）で /api/dropbox/download を Dropbox JS SDK 経由に振り替える。
// dev / Express がある環境ではサーバ応答が優先され、404 / ネット完全断のときだけ Dropbox 直に逃がす。
installDropboxFetchShim();

createRoot(document.getElementById("root")!).render(<App />);
