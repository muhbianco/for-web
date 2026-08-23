import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATION_FAILED,
  UNVERIFIED_ACCOUNT,
  apiErrorType,
  emailVerificationEnabled,
  shouldPromptCheckEmail,
} from "./accountActivation.ts";

test("apiErrorType reads object and JSON string bodies", () => {
  assert.equal(apiErrorType({ type: UNVERIFIED_ACCOUNT }), UNVERIFIED_ACCOUNT);
  assert.equal(
    apiErrorType(JSON.stringify({ type: OPERATION_FAILED })),
    OPERATION_FAILED,
  );
  assert.equal(apiErrorType("not-json"), "");
  assert.equal(apiErrorType(undefined), "");
});

test("live /api features.email wins over a stale client snapshot", () => {
  assert.equal(
    emailVerificationEnabled({ features: { email: true } }, false),
    true,
  );
  assert.equal(
    emailVerificationEnabled({ features: { email: false } }, true),
    false,
  );
  assert.equal(emailVerificationEnabled(undefined, true), true);
  assert.equal(emailVerificationEnabled({}, false), false);
});

test("successful create with email on goes to the inbox screen", () => {
  assert.equal(
    shouldPromptCheckEmail({
      emailVerificationEnabled: true,
      loginErrorType: "",
    }),
    true,
  );
});

test("UnverifiedAccount after login also goes to the inbox screen", () => {
  assert.equal(
    shouldPromptCheckEmail({
      emailVerificationEnabled: false,
      loginErrorType: UNVERIFIED_ACCOUNT,
    }),
    true,
  );
});

test("create without email verification and a successful login stays on login", () => {
  assert.equal(
    shouldPromptCheckEmail({
      emailVerificationEnabled: false,
      loginErrorType: "",
    }),
    false,
  );
});
