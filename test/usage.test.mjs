import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchAnthropicOAuthUsage,
  formatAnthropicUsageLimitError,
  isRateLimitError,
} from "../.test-dist/usage.js";

const cappedFableUsage = {
  five_hour: {
    utilization: 46,
    resets_at: "2026-07-31T19:40:00.794720+00:00",
  },
  seven_day: {
    utilization: 67,
    resets_at: "2026-08-05T00:00:00.794742+00:00",
  },
  extra_usage: {
    is_enabled: false,
    monthly_limit: 2000,
    used_credits: 2061,
    utilization: 100,
    currency: "USD",
    decimal_places: 2,
    disabled_reason: "org_level_disabled_until",
    spend_limit_reached: true,
  },
  limits: [
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 100,
      severity: "critical",
      resets_at: "2026-08-04T23:59:59.794994+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: true,
    },
  ],
  spend: {
    used: { amount_minor: 2061, currency: "USD", exponent: 2 },
    limit: { amount_minor: 2000, currency: "USD", exponent: 2 },
    percent: 100,
    severity: "critical",
    enabled: false,
    disabled_reason: "org_level_disabled_until",
  },
};

test("explains a monthly spend cap with the exact spend and affected model", () => {
  const message = formatAnthropicUsageLimitError(cappedFableUsage, "claude-fable-5");

  assert.match(message, /^429 rate limit:/);
  assert.match(message, /monthly Anthropic usage-credit spend limit/i);
  assert.match(message, /\$20\.61 of \$20\.00/);
  assert.match(message, /Fable 5/);
  assert.match(message, /100%/);
  assert.match(message, /claude\.ai\/settings\/usage/);
});

test("explains an active model-scoped allowance when no spend cap was hit", () => {
  const usage = {
    ...cappedFableUsage,
    extra_usage: { ...cappedFableUsage.extra_usage, spend_limit_reached: false },
    spend: { ...cappedFableUsage.spend, percent: 25, enabled: true },
  };

  const message = formatAnthropicUsageLimitError(usage, "claude-fable-5");
  assert.match(message, /Fable 5 weekly usage limit/i);
  assert.match(message, /100%/);
  assert.doesNotMatch(message, /monthly Anthropic usage-credit spend limit/i);
});

test("returns undefined when utilization data does not explain the 429", () => {
  assert.equal(
    formatAnthropicUsageLimitError(
      { limits: [], extra_usage: { spend_limit_reached: false } },
      "claude-opus-5",
    ),
    undefined,
  );
});

test("recognizes Anthropic SDK and serialized rate-limit errors", () => {
  assert.equal(isRateLimitError({ status: 429 }), true);
  assert.equal(isRateLimitError(new Error('429 {"type":"rate_limit_error"}')), true);
  assert.equal(isRateLimitError(new Error("socket closed")), false);
});

test("fetches the OAuth usage endpoint with bearer auth", async () => {
  let capturedUrl;
  let capturedInit;
  const fakeFetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify(cappedFableUsage), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const usage = await fetchAnthropicOAuthUsage(
    "oauth-token",
    "https://api.anthropic.com",
    fakeFetch,
  );

  assert.equal(capturedUrl, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(capturedInit.headers.Authorization, "Bearer oauth-token");
  assert.equal(usage.extra_usage.spend_limit_reached, true);
});

test("usage lookup fails closed when the endpoint is unavailable", async () => {
  const usage = await fetchAnthropicOAuthUsage(
    "oauth-token",
    "https://api.anthropic.com",
    async () => new Response("unavailable", { status: 503 }),
  );
  assert.equal(usage, undefined);
});
