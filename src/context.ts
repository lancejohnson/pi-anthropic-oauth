import {
  getCurrentSystemPrompt,
  getCurrentTools,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

export function resolveProviderContext(messages: TranscriptContext["messages"]) {
  return {
    systemPrompt: getCurrentSystemPrompt(messages),
    tools: getCurrentTools(messages),
  };
}
