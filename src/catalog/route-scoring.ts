import { INCIDENT_PACKET } from "../incident.js";
import type { JsonValue } from "../protocol.js";
import type { Plugin } from "../runtime.js";

export interface RouteScore {
  routeId: string;
  eligible: boolean;
  score: number;
  checks: {
    latency: boolean;
    packetLoss: boolean;
    energy: boolean;
  };
}

export function scoreIncidentRoutes(): RouteScore[] {
  const limits = INCIDENT_PACKET.constraints;
  return INCIDENT_PACKET.candidates
    .map((route) => {
      const checks = {
        latency: route.latencyMs <= limits.maximumLatencyMs,
        packetLoss: route.packetLossPercent <= limits.maximumPacketLossPercent,
        energy: route.energyUnits <= limits.maximumEnergyUnits,
      };
      return {
        routeId: route.routeId,
        eligible: Object.values(checks).every(Boolean),
        score: Math.round(
          route.latencyMs + route.packetLossPercent * 10 + route.energyUnits * 5,
        ),
        checks,
      };
    })
    .sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.score - right.score);
}

export function routeScoringPlugin(): Plugin {
  return {
    name: "capability:route_scoring",
    setup(context) {
      context.contributePrompt(
        "route-scoring-rule",
        "When route_scoring is installed, call score_routes and treat eligibility as a hard gate before comparing scores.",
      );
      context.registerTool({
        name: "score_routes",
        description: "Score the fixed incident packet routes and show every constraint check.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: () => ({
          formula: "latency + packetLoss×10 + energy×5; eligibility is a hard gate",
          routes: scoreIncidentRoutes(),
        }) as unknown as JsonValue,
      });
    },
  };
}
