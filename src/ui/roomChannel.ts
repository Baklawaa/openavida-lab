import { RoomSession, cloneOp, peerColor, type PeerPresence, type RoomOp } from "../sim/net";

export function newPeerId(): string {
  return "p" + Math.random().toString(36).slice(2, 10);
}

export function openRoomChannel(
  roomId: string,
  session: RoomSession,
  onOp: (op: RoomOp) => void,
): { post: (op: RoomOp) => void; close: () => void } {
  if (typeof BroadcastChannel === "undefined") {
    return { post() {}, close() {} };
  }
  const ch = new BroadcastChannel("openavida-room-" + roomId);
  ch.onmessage = (ev: MessageEvent<RoomOp>) => {
    if (!ev.data || ev.data === undefined) return;
    onOp(ev.data);
  };
  const self = session.self;
  ch.postMessage({ kind: "hello", peer: self } satisfies RoomOp);
  return {
    post(op: RoomOp) {
      ch.postMessage(cloneOp(op));
    },
    close() {
      ch.postMessage({ kind: "bye", peerId: self.id } satisfies RoomOp);
      ch.close();
    },
  };
}

export function makeSelf(name: string, index: number): PeerPresence {
  return {
    id: newPeerId(),
    name,
    role: "host",
    color: peerColor(index),
    x: 0,
    y: 0,
    lastTick: 0,
  };
}
