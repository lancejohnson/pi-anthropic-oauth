import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { streamAnthropicOAuth } from "../.test-dist/stream.js";

// Capture the actual SDK request, without credentials or an Anthropic call.
test("outgoing cache markers honor Pi retention preferences", { timeout: 15_000 }, async (t) => {
  let payload;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "message_start", message: { id: "test", type: "message", role: "assistant", content: [], model: "test", usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } },
      { type: "message_stop" },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const model = {
    id: "claude-opus-5", provider: "anthropic", api: "anthropic-messages",
    baseUrl: `http://127.0.0.1:${server.address().port}`, maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const context = { messages: [
    { role: "system", content: "Keep the system prefix stable.", timestamp: 0 },
    { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 0 },
  ] };
  const originalContext = structuredClone(context);
  const previousEnv = process.env.PI_CACHE_RETENTION;
  t.after(() => {
    if (previousEnv === undefined) delete process.env.PI_CACHE_RETENTION;
    else process.env.PI_CACHE_RETENTION = previousEnv;
  });
  for (const { name, processEnv, options = {}, compat, toolResult, expected } of [
    { name: "default is short", expected: { type: "ephemeral" } },
    { name: "process environment enables long", processEnv: "long", expected: { type: "ephemeral", ttl: "1h" } },
    { name: "explicit short wins", processEnv: "long", options: { cacheRetention: "short" }, expected: { type: "ephemeral" } },
    { name: "none disables every marker", processEnv: "long", options: { cacheRetention: "none" } },
    { name: "explicit long wins", processEnv: "short", options: { cacheRetention: "long" }, expected: { type: "ephemeral", ttl: "1h" } },
    { name: "scoped environment enables long", options: { env: { PI_CACHE_RETENTION: "long" } }, expected: { type: "ephemeral", ttl: "1h" } },
    { name: "scoped short wins over process long", processEnv: "long", options: { env: { PI_CACHE_RETENTION: "short" } }, expected: { type: "ephemeral" } },
    { name: "unsupported long falls back to short", options: { cacheRetention: "long" }, compat: { supportsLongCacheRetention: false }, expected: { type: "ephemeral" } },
    { name: "tool results use long retention", processEnv: "long", toolResult: true, expected: { type: "ephemeral", ttl: "1h" } },
    { name: "summary options also disable tool-result caching", processEnv: "long", options: { cacheRetention: "none" }, toolResult: true },
  ]) {
    await t.test(name, async () => {
      if (processEnv === undefined) delete process.env.PI_CACHE_RETENTION;
      else process.env.PI_CACHE_RETENTION = processEnv;
      const requestContext = toolResult ? { messages: [...context.messages,
        { role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }],
          api: model.api, provider: model.provider, model: model.id, stopReason: "toolUse", timestamp: 0 },
        { role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "File contents" }], isError: false, timestamp: 0 },
      ] } : context;
      const before = structuredClone(requestContext);
      const result = await streamAnthropicOAuth({ ...model, compat }, requestContext, {
        apiKey: "sk-ant-oat-test-not-a-credential", ...options,
      }).result();
      assert.deepEqual(requestContext, before, "conversion must not mutate the transcript");
      assert.equal(result.stopReason, "stop", result.errorMessage);
      assert.equal(payload.system.length, 2);
      for (const block of [...payload.system, ...payload.messages.at(-1).content]) {
        assert.deepEqual(block.cache_control, expected);
        assert.equal(Object.hasOwn(block, "cache_control"), expected !== undefined);
      }
      assert.deepEqual(context, originalContext, "conversion must not mutate the transcript");
    });
  }
});
