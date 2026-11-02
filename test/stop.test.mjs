import test from "node:test";
import assert from "node:assert/strict";
import { stopErrorMessage } from "../.test-dist/stream.js";

test("refusal keeps Anthropic's explanation and category", () => {
  assert.equal(
    stopErrorMessage("refusal", { category: "cyber", explanation: "Blocked under the Usage Policy." }),
    "Refused (cyber): Blocked under the Usage Policy.",
  );
  assert.equal(stopErrorMessage("refusal", null), "The model refused to complete the request");
});

test("other error stops name the raw reason", () => {
  assert.equal(stopErrorMessage("sensitive"), "Anthropic stopped with: sensitive");
});
