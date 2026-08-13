import { readFile, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { JsonValue, ToolDefinition } from "./protocol.js";

export const RECOVERY_PLAN = {
  routeId: "ASTER",
  isolateRelay: "RELAY-7",
  reasonCode: "THERMAL_DRIFT",
} as const;

export interface IncidentPacket {
  incidentId: string;
  symptom: string;
  constraints: {
    maximumLatencyMs: number;
    maximumPacketLossPercent: number;
    maximumEnergyUnits: number;
  };
  candidates: Array<{
    routeId: string;
    latencyMs: number;
    packetLossPercent: number;
    energyUnits: number;
  }>;
  telemetry: string[];
}

const readFileAsync = promisify(readFile);
const defaultFixture = new URL("../demo-workspace/incident.json", import.meta.url);

export const INCIDENT_PACKET = parseIncidentPacket(
  JSON.parse(readFileSync(defaultFixture, "utf8")),
  defaultFixture.pathname,
);

export async function loadIncidentPacket(workspace: string): Promise<IncidentPacket> {
  const path = join(workspace, "incident.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFileAsync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot load the bounded incident packet at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseIncidentPacket(parsed, path);
}

export interface SubmissionState {
  acceptedPlan: typeof RECOVERY_PLAN | null;
}

export function createIncidentTools(
  state: SubmissionState,
  packet: IncidentPacket = INCIDENT_PACKET,
): ToolDefinition[] {
  return [
    {
      name: "read_incident_packet",
      description: "Read the fixed Mars relay incident packet, candidate routes, and telemetry.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => packet as unknown as JsonValue,
    },
    {
      name: "submit_recovery_plan",
      description: "Submit the route, relay isolation, and diagnosed reason code for verification.",
      inputSchema: {
        type: "object",
        properties: {
          routeId: { type: "string" },
          isolateRelay: { type: "string" },
          reasonCode: { type: "string" },
        },
        required: ["routeId", "isolateRelay", "reasonCode"],
        additionalProperties: false,
      },
      execute: (input) => {
        const accepted = JSON.stringify(input) === JSON.stringify(RECOVERY_PLAN);
        if (accepted) state.acceptedPlan = RECOVERY_PLAN;
        return {
          accepted,
          verification: accepted
            ? "Route satisfies all constraints; RELAY-7 is isolated."
            : "Plan does not match the uniquely valid recovery route.",
        };
      },
    },
  ];
}

function parseIncidentPacket(value: unknown, source: string): IncidentPacket {
  if (!isRecord(value)) throw new Error(`Invalid incident packet at ${source}: root must be an object.`);
  const constraints = value.constraints;
  const candidates = value.candidates;
  if (
    typeof value.incidentId !== "string" ||
    typeof value.symptom !== "string" ||
    !isRecord(constraints) ||
    !isFiniteNumber(constraints.maximumLatencyMs) ||
    !isFiniteNumber(constraints.maximumPacketLossPercent) ||
    !isFiniteNumber(constraints.maximumEnergyUnits) ||
    !Array.isArray(candidates) ||
    !candidates.every(isCandidate) ||
    !Array.isArray(value.telemetry) ||
    !value.telemetry.every((line) => typeof line === "string")
  ) {
    throw new Error(`Invalid incident packet at ${source}: fields do not match the Nano fixture schema.`);
  }
  return structuredClone(value) as unknown as IncidentPacket;
}

function isCandidate(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.routeId === "string" &&
    isFiniteNumber(value.latencyMs) &&
    isFiniteNumber(value.packetLossPercent) &&
    isFiniteNumber(value.energyUnits)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
