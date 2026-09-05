import { mount } from "./app";

// PHASE 2 HOOK: 3D continuum viewport, multiplayer room cursor, LLM policy overlay.

if (location.protocol === "file:") {
  const warn = document.getElementById("file-warning");
  if (warn) warn.hidden = false;
} else {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app missing");
  mount(root);
}
