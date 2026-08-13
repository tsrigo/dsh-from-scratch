import type { ModelMessage, ToolMessage, ToolSchema, UnifiedRequest } from "./protocol.js";

export interface ProjectionSettings {
  maxToolResultChars: number;
  toolResultHeadChars: number;
  toolResultTailChars: number;
}

export const DEFAULT_PROJECTION: ProjectionSettings = {
  maxToolResultChars: 720,
  toolResultHeadChars: 430,
  toolResultTailChars: 170,
};

export interface RequestPart {
  id: string;
  kind: "system" | "tools" | "message" | "dynamic";
  stability: "stable" | "append-only" | "step-variable";
  label: string;
  value: unknown;
  approximateTokens: number;
}

export interface PrefixComparison {
  sharedParts: number;
  sharedApproximateTokens: number;
  previousParts: number;
  currentParts: number;
  firstInvalidation: string | null;
  note: string;
}

export interface ClippedToolResult {
  content: string;
  omittedCharacters: number;
}

export function projectMessages(
  messages: ModelMessage[],
  settings: ProjectionSettings = DEFAULT_PROJECTION,
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool") return structuredClone(message);
    const clipped = clipToolResult(message.content, settings);
    return { ...message, content: clipped.content } satisfies ToolMessage;
  });
}

export function clipToolResult(
  content: string,
  settings: ProjectionSettings = DEFAULT_PROJECTION,
): ClippedToolResult {
  if (content.length <= settings.maxToolResultChars) {
    return { content, omittedCharacters: 0 };
  }
  const omittedCharacters = Math.max(
    0,
    content.length - settings.toolResultHeadChars - settings.toolResultTailChars,
  );
  const marker = `\n[… ${omittedCharacters} characters omitted from the model projection …]\n`;
  return {
    content:
      content.slice(0, settings.toolResultHeadChars) +
      marker +
      content.slice(content.length - settings.toolResultTailChars),
    omittedCharacters,
  };
}

export function describeRequest(request: UnifiedRequest): RequestPart[] {
  const parts: RequestPart[] = [
    part("system", "system", "stable", "System prompt", request.system),
    part("tools", "tools", "stable", "Tool schemas", request.tools),
  ];
  for (const [index, message] of request.messages.entries()) {
    const suffix = message.role === "tool" ? ` · ${message.name}` : "";
    parts.push(
      part(
        `message-${index}`,
        "message",
        "append-only",
        `${message.role}${suffix}`,
        message,
      ),
    );
  }
  if (request.dynamicContext) {
    parts.push(
      part(
        "dynamic",
        "dynamic",
        "step-variable",
        "Step context",
        request.dynamicContext,
      ),
    );
  }
  return parts;
}

export function compareRequestPrefix(
  previous: UnifiedRequest | undefined,
  current: UnifiedRequest,
): PrefixComparison {
  const currentParts = describeRequest(current);
  if (!previous) {
    return {
      sharedParts: 0,
      sharedApproximateTokens: 0,
      previousParts: 0,
      currentParts: currentParts.length,
      firstInvalidation: "First request has no predecessor.",
      note: "Teaching estimate only; no provider cache was queried.",
    };
  }
  const previousParts = describeRequest(previous);
  let sharedParts = 0;
  while (
    sharedParts < previousParts.length &&
    sharedParts < currentParts.length &&
    canonical(previousParts[sharedParts]?.value) === canonical(currentParts[sharedParts]?.value)
  ) {
    sharedParts += 1;
  }
  return {
    sharedParts,
    sharedApproximateTokens: currentParts
      .slice(0, sharedParts)
      .reduce((total, item) => total + item.approximateTokens, 0),
    previousParts: previousParts.length,
    currentParts: currentParts.length,
    firstInvalidation:
      sharedParts === Math.min(previousParts.length, currentParts.length)
        ? null
        : currentParts[sharedParts]?.label ?? "Request end",
    note: "Longest identical canonical prefix; approximate tokens, not provider cache usage.",
  };
}

export function approximateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : canonical(value);
  return Math.max(1, Math.ceil([...text].length / 4));
}

export function toolSchemas(tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>): ToolSchema[] {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

function part(
  id: string,
  kind: RequestPart["kind"],
  stability: RequestPart["stability"],
  label: string,
  value: unknown,
): RequestPart {
  return { id, kind, stability, label, value, approximateTokens: approximateTokens(value) };
}

function canonical(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortObject(item)]),
    );
  }
  return value;
}
