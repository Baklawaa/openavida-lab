/**
 * Host-authority room protocol. Transport is pluggable (BroadcastChannel in
 * the UI). Tests apply ops in-process to a second World.
 */
import { applyBottleneck, paintTerrain, placeOrganismAt } from "./sandbox";
import type { World } from "./world";
import type { BrushKind, WorldSnapshot } from "./types";

export type PeerRole = "host" | "experimenter" | "spectator";

export interface PeerPresence {
  id: string;
  name: string;
  role: PeerRole;
  color: string;
  x: number;
  y: number;
  lastTick: number;
}

export type RoomOp =
  | { kind: "hello"; peer: PeerPresence }
  | { kind: "bye"; peerId: string }
  | { kind: "cursor"; peerId: string; x: number; y: number }
  | { kind: "role"; peerId: string; role: PeerRole }
  | { kind: "snapshot"; snap: WorldSnapshot }
  | { kind: "paint"; x: number; y: number; radius: number; brush: BrushKind; amount?: number }
  | { kind: "place"; x: number; y: number; genome: string }
  | { kind: "step"; n: number }
  | { kind: "pause"; paused: boolean }
  | { kind: "bottleneck"; keep: number };

export interface RoomMetrics {
  peers: number;
  opsApplied: number;
  snapshots: number;
  lastOpKind: string;
}

const PEER_COLORS = ["#3ee0c0", "#f0d35a", "#c87bff", "#6ea8ff", "#ff6b8a", "#9dffb0"];

export function peerColor(i: number): string {
  return PEER_COLORS[i % PEER_COLORS.length]!;
}

export function canMutateWorld(role: PeerRole): boolean {
  return role === "host" || role === "experimenter";
}

/**
 * Apply a world-mutating op. Presence ops are ignored here (session-level).
 * Returns true if the world was touched.
 */
export function applyRoomOp(world: World, op: RoomOp): boolean {
  switch (op.kind) {
    case "snapshot":
      world.restore(op.snap);
      return true;
    case "paint":
      paintTerrain(world, op.x, op.y, op.radius, op.brush, op.amount);
      return true;
    case "place":
      placeOrganismAt(world, op.x, op.y, op.genome);
      return true;
    case "step": {
      const n = Math.max(1, Math.min(30, op.n | 0));
      for (let i = 0; i < n; i++) world.step();
      return true;
    }
    case "bottleneck":
      applyBottleneck(world, op.keep);
      return true;
    default:
      return false;
  }
}

export class RoomSession {
  readonly selfId: string;
  hostId: string;
  peers = new Map<string, PeerPresence>();
  metrics: RoomMetrics = { peers: 1, opsApplied: 0, snapshots: 0, lastOpKind: "" };
  paused = false;

  /**
   * `claimHost: false` leaves hostId empty until a host hello arrives.
   * Passing no second arg used to default hostId to self — joiners must
   * pass `{ claimHost: false }` or they would ignore snapshots.
   */
  constructor(self: PeerPresence, opts?: { claimHost?: boolean; hostId?: string }) {
    const claim = opts?.claimHost ?? self.role === "host";
    if (claim) {
      self.role = "host";
      this.hostId = self.id;
    } else {
      if (self.role === "host") self.role = "experimenter";
      this.hostId = opts?.hostId ?? "";
    }
    this.selfId = self.id;
    this.peers.set(self.id, { ...self });
  }

  get self(): PeerPresence {
    return this.peers.get(this.selfId)!;
  }

  get isHost(): boolean {
    return this.hostId !== "" && this.selfId === this.hostId;
  }

  setCursor(x: number, y: number): RoomOp | null {
    const s = this.self;
    const gx = x | 0;
    const gy = y | 0;
    if (s.x === gx && s.y === gy) return null;
    s.x = gx;
    s.y = gy;
    return { kind: "cursor", peerId: this.selfId, x: gx, y: gy };
  }

  applyPresence(op: RoomOp): void {
    if (op.kind === "hello") {
      this.peers.set(op.peer.id, { ...op.peer });
      if (op.peer.role === "host") this.hostId = op.peer.id;
    } else if (op.kind === "bye") {
      this.peers.delete(op.peerId);
    } else if (op.kind === "cursor") {
      const p = this.peers.get(op.peerId);
      if (p) {
        p.x = op.x;
        p.y = op.y;
      }
    } else if (op.kind === "role") {
      const p = this.peers.get(op.peerId);
      if (p) p.role = op.role;
      if (op.role === "host") this.hostId = op.peerId;
    } else if (op.kind === "pause") {
      this.paused = op.paused;
    }
    this.metrics.peers = this.peers.size;
  }

  applyWorld(world: World, op: RoomOp): boolean {
    const touched = applyRoomOp(world, op);
    if (touched) {
      this.metrics.opsApplied++;
      this.metrics.lastOpKind = op.kind;
      if (op.kind === "snapshot") this.metrics.snapshots++;
    } else {
      this.applyPresence(op);
    }
    return touched;
  }
}

export function canDriveClock(session: RoomSession | null | undefined): boolean {
  return !session || session.isHost;
}

export type RoomReply = (op: RoomOp) => void;

/**
 * Host-authority inbox. Only the host replies to hello (hello + snapshot)
 * so joiners learn the host id and receive world state. Joiners never
 * answer hello (avoids a hello loop).
 */
export function handleIncoming(session: RoomSession, op: RoomOp, world: World, reply: RoomReply): void {
  if (op.kind === "hello") {
    session.applyPresence(op);
    if (session.isHost && op.peer.id !== session.selfId) {
      reply({ kind: "hello", peer: { ...session.self } });
      reply({ kind: "snapshot", snap: world.snapshot() });
    }
    return;
  }
  if (op.kind === "snapshot") {
    if (!session.isHost) {
      applyRoomOp(world, op);
      session.metrics.opsApplied++;
      session.metrics.snapshots++;
      session.metrics.lastOpKind = "snapshot";
    }
    return;
  }
  if (op.kind === "cursor" || op.kind === "bye" || op.kind === "role" || op.kind === "pause") {
    session.applyPresence(op);
    return;
  }
  if (op.kind === "paint" || op.kind === "place" || op.kind === "step" || op.kind === "bottleneck") {
    if (session.isHost) {
      applyRoomOp(world, op);
      session.metrics.opsApplied++;
      session.metrics.lastOpKind = op.kind;
      reply({ kind: "snapshot", snap: world.snapshot() });
    }
  }
}

export function cloneOp(op: RoomOp): RoomOp {
  return JSON.parse(JSON.stringify(op)) as RoomOp;
}
