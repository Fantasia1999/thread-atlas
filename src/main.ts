import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "katex/dist/katex.min.css";
import "./index.css";

import { SessionStore } from "./store/sessionStore.js";
import { ThreadAtlasApp } from "./ui/app.js";

const root = document.querySelector("#app");

if (!(root instanceof HTMLElement)) {
  throw new Error("Missing #app root element.");
}

const store = new SessionStore();
const app = new ThreadAtlasApp(root, store);

void app.init();
