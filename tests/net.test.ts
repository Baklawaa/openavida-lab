import { describe, expect, it } from "vitest";
import {
  RoomSession,
  World,
  applyRoomOp,
  canDriveClock,
  canMutateWorld,
  genomeForKit,
  handleIncoming,
  paintTerrain,
  placeOrganismAt,
} from "../src/sim/index";

describe("host-authority room ops", () => {
  it("applying a host snapshot to a second world copies occupancy, fields, and organisms", () => {
    const host = new World({ width: 16, height: 16, seed: 7, startPopulation: 0 });
    expect(placeOrganismAt(host, 3, 3, genomeForKit("phototroph"))).toBeTruthy();
    paintTerrain(host, 5, 5, 1, "nutrientBlob", 0.8);
    host.step();
    host.step();
    const client = new World({ width: 16, height: 16, seed: 99, startPopulation: 0 });
    expect(client.hashState()).not.toBe(host.hashState());
    applyRoomOp(client, { kind: "snapshot", snap: host.snapshot() });
    expect(client.hashState()).toBe(host.hashState());
    expect(client.organisms.length).toBe(host.organisms.length);
    expect(client.organisms[0]!.genome).toBe(host.organisms[0]!.genome);
    expect(client.fields.nutrient[5 * 16 + 5]).toBe(host.fields.nutrient[5 * 16 + 5]);
  });

  it("the same paint op applied to two copies stays in lockstep", () => {
    const a = new World({ width: 16, height: 16, seed: 3, startPopulation: 0 });
    const b = new World({ width: 16, height: 16, seed: 3, startPopulation: 0 });
    const op = { kind: "paint" as const, x: 4, y: 6, radius: 2, brush: "toxinBlob" as const, amount: 0.7 };
    applyRoomOp(a, op);
    applyRoomOp(b, op);
    expect(a.hashState()).toBe(b.hashState());
    applyRoomOp(a, { kind: "place", x: 2, y: 2, genome: genomeForKit("heterotroph") });
    applyRoomOp(b, { kind: "place", x: 2, y: 2, genome: genomeForKit("heterotroph") });
    expect(a.hashState()).toBe(b.hashState());
    expect(a.organisms.length).toBe(1);
  });

  it("spectators cannot mutate; experimenters can", () => {
    expect(canMutateWorld("spectator")).toBe(false);
    expect(canMutateWorld("experimenter")).toBe(true);
    expect(canMutateWorld("host")).toBe(true);
    const host = new RoomSession({
      id: "h",
      name: "host",
      role: "host",
      color: "#3ee0c0",
      x: 0,
      y: 0,
      lastTick: 0,
    });
    host.applyPresence({
      kind: "hello",
      peer: { id: "s", name: "spec", role: "spectator", color: "#f0d", x: 1, y: 1, lastTick: 0 },
    });
    expect(host.metrics.peers).toBe(2);
    expect(host.isHost).toBe(true);
  });
});

describe("join sequence (two in-process sessions)", () => {
  function peer(id: string, role: "host" | "experimenter") {
    return { id, name: id, role, color: "#3ee0c0", x: 0, y: 0, lastTick: 0 };
  }

  it("joinRoom(false) is not host until a host hello; host replies hello+snapshot", () => {
    const hostWorld = new World({ width: 16, height: 16, seed: 7, startPopulation: 0 });
    expect(placeOrganismAt(hostWorld, 3, 3, genomeForKit("phototroph"))).toBeTruthy();
    paintTerrain(hostWorld, 5, 5, 1, "nutrientBlob", 0.8);
    hostWorld.step();

    const host = new RoomSession(peer("h", "host"), { claimHost: true });
    const guestWorld = new World({ width: 16, height: 16, seed: 99, startPopulation: 0 });
    const guest = new RoomSession(peer("g", "experimenter"), { claimHost: false });
    expect(guest.isHost).toBe(false);
    expect(canDriveClock(guest)).toBe(false);
    expect(canDriveClock(host)).toBe(true);
    expect(guestWorld.hashState()).not.toBe(hostWorld.hashState());

    handleIncoming(host, { kind: "hello", peer: guest.self }, hostWorld, (op) => {
      handleIncoming(guest, op, guestWorld, () => {
        throw new Error("guest must not reply to host hello (hello loop)");
      });
    });

    expect(host.peers.has("g")).toBe(true);
    expect(guest.isHost).toBe(false);
    expect(guest.hostId).toBe("h");
    expect(guest.peers.has("h")).toBe(true);
    expect(guestWorld.hashState()).toBe(hostWorld.hashState());
    expect(guest.metrics.snapshots).toBeGreaterThan(0);
    expect(guestWorld.organisms[0]!.genome).toBe(hostWorld.organisms[0]!.genome);
  });

  it("cursor ops update the peer on the other session", () => {
    const hostWorld = new World({ width: 8, height: 8, seed: 1, startPopulation: 0 });
    const guestWorld = new World({ width: 8, height: 8, seed: 1, startPopulation: 0 });
    const host = new RoomSession(peer("h", "host"), { claimHost: true });
    const guest = new RoomSession(peer("g", "experimenter"), { claimHost: false });
    handleIncoming(host, { kind: "hello", peer: guest.self }, hostWorld, (op) => {
      handleIncoming(guest, op, guestWorld, () => {});
    });
    const cur = guest.setCursor(4, 6);
    expect(cur).toEqual({ kind: "cursor", peerId: "g", x: 4, y: 6 });
    expect(guest.setCursor(4, 6)).toBeNull();
    handleIncoming(host, cur!, hostWorld, () => {
      throw new Error("cursor must not mutate the world");
    });
    expect(host.peers.get("g")!.x).toBe(4);
    expect(host.peers.get("g")!.y).toBe(6);
  });
});
