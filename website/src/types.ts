export interface RequestPart {
  id: string;
  kind: "system" | "tools" | "message" | "dynamic";
  stability: "stable" | "append-only" | "step-variable";
  label: string;
  value: unknown;
  approximateTokens: number;
}

export interface RequestEvidence {
  step: number;
  stepId?: string;
  request: {
    system: string;
    tools: Array<{ name: string; description: string }>;
    messages: Array<{ role: string; content: string; name?: string }>;
    dynamicContext: string;
  };
  parts: RequestPart[];
  totalApproximateTokens: number;
  prefix: {
    sharedParts: number;
    sharedApproximateTokens: number;
    firstInvalidation: string | null;
    note: string;
  };
}

export interface TraceItem {
  eventId: number;
  type: string;
  title: string;
  detail: string;
}

export interface GraphSnapshot {
  stepId: string;
  eventId: number;
  plugins: string[];
  tools: Array<{ name: string; owner?: string; plugin?: string }>;
  prompts: Array<{ id?: string; text: string; owner?: string; plugin?: string }>;
  services: Array<{ name: string; provider: string }>;
  relations: Array<{ consumer: string; service: string; provider: string }>;
  nodes: Array<{ id: string; label: string; kind: string }>;
  edges: Array<{ from: string; to: string; label: string }>;
}

export interface Chapter {
  id: string;
  number: string;
  tag: string;
  previousTag: string;
  scenario: string;
  sourcePath: string;
  lessonPath: string;
  shortTitle: string;
  title: string;
  question: string;
  commit: string;
  lesson: string;
  source: { path: string; content: string };
  diff: string;
  verdict: string;
  requests: RequestEvidence[];
  events: Array<Record<string, unknown> & { id: number; type: string }>;
  trace: TraceItem[];
  graphs: GraphSnapshot[];
  ptc?: {
    program: string;
    comparison: { standard: string; ptc: string; nanoBoundary: string };
  };
}

export interface TutorialData {
  schemaVersion: number;
  project: {
    name: string;
    scenario: string;
    dataPolicy: string;
    selectedScope: Record<string, boolean>;
  };
  chapters: Chapter[];
}

export type PanelTab = "source" | "diff" | "request" | "events" | "graph";
