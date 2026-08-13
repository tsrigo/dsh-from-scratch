export const PTC_PRESENTATION_EXAMPLE = String.raw`// Static teaching contrast — Nano never executes this program.
const incident = await tools.read_incident_packet({});
const valid = incident.candidates.filter((route) =>
  route.latencyMs <= incident.constraints.maximumLatencyMs &&
  route.packetLossPercent <= incident.constraints.maximumPacketLossPercent &&
  route.energyUnits <= incident.constraints.maximumEnergyUnits
);
await tools.submit_recovery_plan({
  routeId: valid[0].routeId,
  isolateRelay: "RELAY-7",
  reasonCode: "THERMAL_DRIFT"
});`;

export const MODE_COMPARISON = {
  standard: "Presents each tool schema; the model returns ordinary tool calls handled by the Agent Loop.",
  ptc: "Keeps the standard preset's abilities but exposes them through the Code Mode SDK for programmatic composition.",
  nanoBoundary: "Nano implements only ordinary tool calls. The PTC program above is inert explanatory text.",
} as const;
