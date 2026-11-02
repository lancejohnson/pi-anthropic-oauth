# pi-anthropic-oauth

[![npm](https://img.shields.io/npm/v/pi-anthropic-oauth?style=flat-square&logo=npm&logoColor=white&label=npm&color=7c3aed)](https://www.npmjs.com/package/pi-anthropic-oauth)

Use Claude Pro/Max in Pi with browser OAuth.

> [!IMPORTANT]
> This extension supports Pi 0.80.8 or later.

## Features

- Claude Pro/Max login from `/login`
- Automatic token refresh
- Claude Code-compatible OAuth headers and prompt shaping
- Usage-aware 429 errors with spend-limit, scoped-model, and reset details
- No Anthropic API key needed
- Uses the Anthropic models available in Pi's built-in model registry
- Auto-creates `~/.Claude Code` → `~/.pi` symlink when missing

## Quick start

```bash
pi install npm:pi-anthropic-oauth
```

Start Pi, then run Pi's login command:

```text
/login
```

Choose:

```text
Claude Pro/Max
```

Complete the browser login. After login, select an Anthropic model in Pi.

When the extension is active, `/login` includes `Claude Pro/Max` and Anthropic models show `(sub)` after OAuth login.

Update with:

```bash
pi update npm:pi-anthropic-oauth
```

> [!NOTE]
> Anthropic auth changes are closely monitored for quick compatibility updates.

## System prompt rewriting

When using Claude Pro/Max OAuth, the extension prepends Claude Code identity text and rewrites standalone `Pi` / `pi` references in Pi's system prompt to `Claude Code`. The rewrite mode defaults to `aggressive`:

```bash
PI_ANTHROPIC_OAUTH_REWRITE_MODE=aggressive
```

Other modes are opt-in and avoid rewriting some technical strings such as paths, package names, or repository names. If OAuth starts failing, switch back to `aggressive`.

Available modes:

| Mode             | Behavior                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `aggressive`     | Default. Replaces standalone `Pi` / `pi` wherever the word-boundary pattern matches.                        |
| `path-safe`      | Avoids replacing `Pi` / `pi` immediately after `/` or `\`, preserving path segments like `/srv/dev/pi-foo`. |
| `technical-safe` | Avoids replacing `Pi` / `pi` next to common technical-token separators: `/`, `\`, `.`, `@`, `:`, `_`, `-`.  |
| `custom`         | Uses `PI_ANTHROPIC_OAUTH_REWRITE_PATTERN` as the replacement regex.                                         |

Custom patterns can be a regex source or a JavaScript-style regex literal. The `g` flag is added automatically when omitted:

```bash
PI_ANTHROPIC_OAUTH_REWRITE_MODE=custom
PI_ANTHROPIC_OAUTH_REWRITE_PATTERN='(?<![/\\])\b[Pp]i\b'
# or
PI_ANTHROPIC_OAUTH_REWRITE_PATTERN='/\bpi\b/gi'
```

There is no separate off mode. If you need to disable rewriting entirely, use a custom pattern that never matches, such as `(?!)`. Disabling or weakening the rewrite may affect OAuth compatibility.

## Prompt cache retention

The provider honors Pi's `cacheRetention` request option: `none` removes cache markers, `short` uses the default five-minute cache, and `long` requests a one-hour cache on compatible models. Explicit request options take precedence over `PI_CACHE_RETENTION=long`; provider-scoped environment values take precedence over the process environment. Without a long preference, retention defaults to short.

Long retention can avoid rewriting a cached prefix after pauses of five to sixty minutes. It also has a higher cache-write API rate; fewer cache misses do not establish lower subscription-quota consumption.

## Extra models

To add another Anthropic model, create `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "unused",
      "api": "anthropic-messages",
      "models": [
        {
          "id": "your-model-id",
          "name": "Your Model Name"
        }
      ]
    }
  }
}
```

> [!NOTE]
> Opus 5 and Fable 5 are included in Pi's built-in Anthropic model catalog as `claude-opus-5` and `claude-fable-5`.
>
> Pi requires `baseUrl`, `apiKey`, and `api` when defining custom models in `models.json`. With this extension, requests normally authenticate through Claude Pro/Max OAuth after `/login`, so `apiKey` is only a placeholder to satisfy Pi's config requirements and does not need to be a valid Anthropic API key.
>
> Do not use a fake `sk-ant-oat...` value as the placeholder. If OAuth login has not completed, Pi may try to use that fake token and Anthropic will return `401 Invalid bearer token`. Use a harmless placeholder such as `"unused"`, then run `/login` and choose `Claude Pro/Max`.

## Usage-aware rate-limit errors

Anthropic's Messages API often returns a generic `429 rate_limit_error` even when the actual cause is a plan allowance or usage-credit spend cap. For OAuth requests, this extension queries Anthropic's `/api/oauth/usage` endpoint after a 429 and replaces the generic error when it can identify the specific limit. The lookup is best-effort, cached briefly to avoid repeated requests during retries, and falls back to the original API error if usage details are unavailable.

## Troubleshooting

- Run `/login` with no arguments, then choose `Claude Pro/Max`.
- If local callback login does not complete, paste the final callback URL or `code#state` when prompted
- If you see `401 Invalid bearer token`, remove any fake `sk-ant-oat...` placeholder from `~/.pi/agent/models.json` and log in again
- If something breaks, please open an issue with your Pi version, extension version, and error output

## License

MIT
