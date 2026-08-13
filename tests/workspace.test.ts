import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIncidentPacket } from "../src/incident.js";
import { createIncidentTools, type SubmissionState } from "../src/incident.js";

describe("bounded demo workspace", () => {
  it("loads the same validated fixture used by fake and DeepSeek providers", async () => {
    const packet = await loadIncidentPacket(resolve("demo-workspace"));
    expect(packet.incidentId).toBe("MARS-RELAY-204");
    expect(packet.candidates.find((route) => route.routeId === "ASTER")).toMatchObject({
      latencyMs: 58,
      packetLossPercent: 1.2,
      energyUnits: 3,
    });
    expect(packet.telemetry.at(-1)).toContain("temp=79C");
  });

  it("rejects a malformed fixture before the Agent Loop starts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nano-dsh-invalid-"));
    try {
      await writeFile(join(directory, "incident.json"), '{"incidentId":"missing-fields"}\n');
      await expect(loadIncidentPacket(directory)).rejects.toThrow(
        "fields do not match the Nano fixture schema",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts the recovery fields regardless of JSON object key order", async () => {
    const state: SubmissionState = { acceptedPlan: null };
    const submit = createIncidentTools(state).find(
      (tool) => tool.name === "submit_recovery_plan",
    );
    const result = await submit?.execute({
      reasonCode: "THERMAL_DRIFT",
      routeId: "ASTER",
      isolateRelay: "RELAY-7",
    });
    expect(result).toMatchObject({ accepted: true });
    expect(state.acceptedPlan?.routeId).toBe("ASTER");
  });
});
