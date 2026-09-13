/**
 * The experimental toggles and the multiplayer room: the 3D view, brains and
 * LLM checkboxes, the room join/host controls, the peer list and the plate
 * cursors. It also owns the cursor plumbing — emitOp applies the host's
 * snapshot rule, emitCursor broadcasts this peer's cell and paintPeers draws
 * everyone else's cursor on the 2D canvas.
 */
import { handleIncoming, peerColor, RoomSession, type PeerRole, type RoomOp } from "../../sim/index";
import { tDynamic } from "../i18n/runtime";
import { makeSelf, openRoomChannel } from "../roomChannel";
import { el, type LabContext } from "./context";

/** What the experimental panel hands back to the app for the context. */
export interface Experimental {
  emitOp(op: RoomOp): void;
  emitCursor(x: number, y: number): void;
  paintPeers(): void;
  setBrains(on: boolean): void;
  joinRoom(asHost: boolean): void;
}

export function createExperimental(ctx: LabContext): Experimental {
  const { root, state } = ctx;

  function emitOp(op: RoomOp): void {
    if (!state.room || !state.roomPost) return;
    if (op.kind === "cursor" || op.kind === "hello" || op.kind === "bye" || op.kind === "role" || op.kind === "pause") {
      state.roomPost(op);
      return;
    }
    if (state.room.isHost) {
      state.roomPost({ kind: "snapshot", snap: ctx.current().snapshot() });
      return;
    }
    state.roomPost(op);
  }

  function emitCursor(x: number, y: number): void {
    if (!state.room) return;
    const op = state.room.setCursor(x, y);
    if (op) emitOp(op);
  }

  function paintPeers(): void {
    const host = root.querySelector("#mp-peers")!;
    if (!state.room) {
      host.textContent = tDynamic("app.mp.enable");
      ctx.cursors.innerHTML = "";
      return;
    }
    const rows = [...state.room.peers.values()].map((p) => `${p.name} (${p.role})`);
    host.textContent = rows.join(" · ") || "no peers";
    ctx.cursors.innerHTML = "";
    const w = ctx.current();
    for (const p of state.room.peers.values()) {
      if (p.id === state.room.selfId) continue;
      const pos = ctx.renderer.gridToCanvas(p.x, p.y, w);
      const d = el("div", { class: "mp-cursor" });
      d.style.left = `${pos.x}px`;
      d.style.top = `${pos.y}px`;
      d.style.borderColor = p.color;
      d.title = p.name;
      ctx.cursors.append(d);
    }
  }

  const box3d = root.querySelector("#opt-view3d input") as HTMLInputElement;
  const boxBrains = root.querySelector("#opt-brains input") as HTMLInputElement;
  const boxLlm = root.querySelector("#opt-llm input") as HTMLInputElement;
  const boxMp = root.querySelector("#opt-mp input") as HTMLInputElement;
  box3d.checked = state.flags.view3d;
  boxBrains.checked = state.flags.brains;
  boxLlm.checked = state.flags.llmBrains;
  boxMp.checked = state.flags.multiplayer;
  function setBrains(on: boolean): void {
    state.flags.brains = on;
    boxBrains.checked = on;
    ctx.host.apply({ kind: "brains", on, llm: state.flags.llmBrains });
    ctx.status(on ? (state.flags.llmBrains ? "LLM brains on (fallback baseline if no adapter)" : "baseline brains on") : "brains off — phase-1 movement");
  }
  box3d.addEventListener("change", () => ctx.setSurface(box3d.checked ? "3d" : "2d"));
  boxBrains.addEventListener("change", () => setBrains(boxBrains.checked));
  boxLlm.addEventListener("change", () => {
    state.flags.llmBrains = boxLlm.checked;
    if (state.flags.brains) setBrains(true);
  });
  function joinRoom(asHost: boolean): void {
    state.roomClose?.();
    const roomId = (root.querySelector("#mp-room") as HTMLInputElement).value.trim() || "lab";
    const role = (root.querySelector("#mp-role") as HTMLSelectElement).value as PeerRole;
    const self = makeSelf(asHost ? "host" : "peer", state.room?.peers.size ?? 0);
    self.role = asHost ? "host" : role === "host" ? "experimenter" : role;
    self.color = peerColor(asHost ? 0 : 1);
    state.room = new RoomSession(self, { claimHost: asHost });
    state.flags.multiplayer = true;
    boxMp.checked = true;
    const ch = openRoomChannel(roomId, state.room, (op) => {
      if (!state.room) return;
      handleIncoming(state.room, op, ctx.current(), (reply) => state.roomPost?.(reply));
      paintPeers();
    });
    state.roomPost = ch.post;
    state.roomClose = ch.close;
    paintPeers();
    ctx.status(asHost ? `hosting room ${roomId}` : `joined room ${roomId} as ${self.role}`);
  }
  boxMp.addEventListener("change", () => {
    state.flags.multiplayer = boxMp.checked;
    if (boxMp.checked) joinRoom(true);
    else {
      state.roomClose?.();
      state.room = null;
      state.roomPost = null;
      paintPeers();
      ctx.status("multiplayer off");
    }
  });
  root.querySelector("#btn-mp-host")!.addEventListener("click", () => joinRoom(true));
  root.querySelector("#btn-mp-join")!.addEventListener("click", () => joinRoom(false));

  return { emitOp, emitCursor, paintPeers, setBrains, joinRoom };
}
