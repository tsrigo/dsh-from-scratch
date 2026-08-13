import type { JsonValue, ToolDefinition } from "./protocol.js";

export const RECOVERY_PLAN = {
  routeId: "ASTER",
  isolateRelay: "RELAY-7",
  reasonCode: "THERMAL_DRIFT",
} as const;

const telemetry = Array.from({ length: 36 }, (_, index) => {
  const minute = String(index).padStart(2, "0");
  const temperature = index < 30 ? 41 + (index % 4) : 74 + index - 30;
  return `T+${minute} relay=RELAY-7 temp=${temperature}C jitter=${3 + (index % 5)}ms`;
});

export const INCIDENT_PACKET = {
  incidentId: "MARS-RELAY-204",
  symptom: "Surface packets disappear whenever RELAY-7 warms past 76C.",
  constraints: {
    maximumLatencyMs: 65,
    maximumPacketLossPercent: 2,
    maximumEnergyUnits: 5,
  },
  candidates: [
    { routeId: "BOREAL", latencyMs: 42, packetLossPercent: 6.5, energyUnits: 4 },
    { routeId: "ASTER", latencyMs: 58, packetLossPercent: 1.2, energyUnits: 3 },
    { routeId: "CRATER", latencyMs: 75, packetLossPercent: 0.5, energyUnits: 8 },
  ],
  telemetry,
};

export interface SubmissionState {
  acceptedPlan: typeof RECOVERY_PLAN | null;
}

export function createIncidentTools(state: SubmissionState): ToolDefinition[] {
  return [
    {
      name: "read_incident_packet",
      description: "Read the fixed Mars relay incident packet, candidate routes, and telemetry.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => INCIDENT_PACKET as unknown as JsonValue,
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
