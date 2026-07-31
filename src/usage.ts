import { USER_AGENT } from "./auth.js";

const USAGE_PATH = "/api/oauth/usage";
const USAGE_TIMEOUT_MS = 5_000;
const USAGE_CACHE_TTL_MS = 30_000;
const USAGE_SETTINGS_URL = "https://claude.ai/settings/usage";

interface MoneyAmount {
  amount_minor?: number;
  currency?: string;
  exponent?: number;
}

interface UsageLimit {
  kind?: string;
  group?: string;
  percent?: number;
  severity?: string;
  resets_at?: string;
  is_active?: boolean;
  scope?: {
    model?: { id?: string | null; display_name?: string | null } | null;
    surface?: unknown;
  } | null;
}

export interface AnthropicOAuthUsage {
  extra_usage?: {
    is_enabled?: boolean;
    monthly_limit?: number;
    used_credits?: number;
    utilization?: number;
    currency?: string;
    decimal_places?: number;
    disabled_reason?: string | null;
    user_disabled?: boolean;
    spend_limit_reached?: boolean;
  } | null;
  limits?: UsageLimit[];
  spend?: {
    used?: MoneyAmount | null;
    limit?: MoneyAmount | null;
    percent?: number;
    severity?: string;
    enabled?: boolean;
    disabled_reason?: string | null;
  } | null;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

let cachedUsage:
  | { baseUrl: string; expiresAt: number; value: AnthropicOAuthUsage }
  | undefined;
let inFlightUsage:
  | { baseUrl: string; promise: Promise<AnthropicOAuthUsage | undefined> }
  | undefined;

export function isRateLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 429) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate[_ -]?limit(?:_error)?/i.test(message);
}

export async function fetchAnthropicOAuthUsage(
  accessToken: string,
  baseUrl: string,
  fetchImpl: FetchImplementation = fetch,
): Promise<AnthropicOAuthUsage | undefined> {
  try {
    const response = await fetchImpl(new URL(USAGE_PATH, baseUrl), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
        "anthropic-dangerous-direct-browser-access": "true",
        "user-agent": USER_AGENT,
        "x-app": "cli",
      },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const value = (await response.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as AnthropicOAuthUsage;
  } catch {
    return undefined;
  }
}

export async function getCachedAnthropicOAuthUsage(
  accessToken: string,
  baseUrl: string,
): Promise<AnthropicOAuthUsage | undefined> {
  const now = Date.now();
  if (
    cachedUsage &&
    cachedUsage.baseUrl === baseUrl &&
    cachedUsage.expiresAt > now
  ) {
    return cachedUsage.value;
  }
  if (inFlightUsage?.baseUrl === baseUrl) return inFlightUsage.promise;

  const promise = fetchAnthropicOAuthUsage(accessToken, baseUrl).then((value) => {
    if (value) {
      cachedUsage = {
        baseUrl,
        expiresAt: Date.now() + USAGE_CACHE_TTL_MS,
        value,
      };
    }
    return value;
  }).finally(() => {
    if (inFlightUsage?.promise === promise) inFlightUsage = undefined;
  });
  inFlightUsage = { baseUrl, promise };
  return promise;
}

export function formatAnthropicUsageLimitError(
  usage: AnthropicOAuthUsage,
  modelId: string,
): string | undefined {
  const activeLimits = (usage.limits ?? []).filter(
    (limit) => limit.is_active || (limit.percent ?? 0) >= 100,
  );
  const scopedLimit = activeLimits.find((limit) =>
    limitMatchesModel(limit, modelId),
  );
  const spendLimitReached =
    usage.extra_usage?.spend_limit_reached === true ||
    (usage.spend?.percent ?? 0) >= 100;

  if (spendLimitReached) {
    const used = formatSpendAmount(
      usage.spend?.used,
      usage.extra_usage?.used_credits,
      usage.extra_usage?.currency,
      usage.extra_usage?.decimal_places,
    );
    const limit = formatSpendAmount(
      usage.spend?.limit,
      usage.extra_usage?.monthly_limit,
      usage.extra_usage?.currency,
      usage.extra_usage?.decimal_places,
    );
    const amount = used && limit ? ` (${used} of ${limit})` : "";
    const modelName = displayModelName(modelId);
    const scoped = scopedLimit
      ? ` ${modelName} usage is also at ${Math.round(scopedLimit.percent ?? 100)}%.`
      : "";
    return (
      `429 rate limit: You've hit your monthly Anthropic usage-credit spend limit${amount}.` +
      scoped +
      ` Manage it at ${USAGE_SETTINGS_URL}, wait for the limit to reset, or switch models.`
    );
  }

  if (scopedLimit) {
    const modelName = scopedLimit.scope?.model?.display_name
      ? normalizeScopedModelName(scopedLimit.scope.model.display_name, modelId)
      : displayModelName(modelId);
    const reset = formatReset(scopedLimit.resets_at);
    return (
      `429 rate limit: You've hit your ${modelName} weekly usage limit ` +
      `(${Math.round(scopedLimit.percent ?? 100)}%).${reset} ` +
      `Manage usage credits at ${USAGE_SETTINGS_URL} or switch models.`
    );
  }

  const generalLimit = activeLimits[0];
  if (generalLimit) {
    const label = generalLimit.kind === "session" ? "session" : "weekly";
    const reset = formatReset(generalLimit.resets_at);
    return (
      `429 rate limit: You've hit your Anthropic ${label} usage limit ` +
      `(${Math.round(generalLimit.percent ?? 100)}%).${reset} ` +
      `Check ${USAGE_SETTINGS_URL} or switch models.`
    );
  }

  return undefined;
}

function limitMatchesModel(limit: UsageLimit, modelId: string): boolean {
  if (limit.kind !== "weekly_scoped") return false;
  const scope = limit.scope?.model;
  if (!scope) return false;
  const model = modelId.toLowerCase();
  const id = scope.id?.toLowerCase();
  const name = scope.display_name?.toLowerCase();
  if (id && model.includes(id)) return true;
  if (name && model.includes(name)) return true;
  return false;
}

function displayModelName(modelId: string): string {
  const model = modelId.toLowerCase();
  if (model.includes("fable")) return "Fable 5";
  if (model.includes("opus")) return "Opus 5";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return modelId;
}

function normalizeScopedModelName(name: string, modelId: string): string {
  if (/^fable$/i.test(name) && /fable-5/i.test(modelId)) return "Fable 5";
  if (/^opus$/i.test(name) && /opus-5/i.test(modelId)) return "Opus 5";
  return name;
}

function formatSpendAmount(
  money: MoneyAmount | null | undefined,
  fallbackMinor: number | undefined,
  fallbackCurrency = "USD",
  fallbackExponent = 2,
): string | undefined {
  const amountMinor = money?.amount_minor ?? fallbackMinor;
  if (amountMinor === undefined || !Number.isFinite(amountMinor)) return undefined;
  const exponent = money?.exponent ?? fallbackExponent;
  const currency = money?.currency ?? fallbackCurrency;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amountMinor / 10 ** exponent);
  } catch {
    return `${currency} ${(amountMinor / 10 ** exponent).toFixed(exponent)}`;
  }
}

function formatReset(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return ` It resets ${date.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC")}.`;
}
