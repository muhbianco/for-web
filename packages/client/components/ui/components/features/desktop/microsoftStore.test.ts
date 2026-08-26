import assert from "node:assert/strict";
import test from "node:test";

import {
  MICROSOFT_STORE_WEB_URL,
  nativeDownloadHref,
} from "./microsoftStore.ts";

test("Windows abre a Microsoft Store", () => {
  assert.equal(
    nativeDownloadHref(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ),
    MICROSOFT_STORE_WEB_URL,
  );
  assert.match(MICROSOFT_STORE_WEB_URL, /XPFCFRJ95KS7M5/);
});

test("Android e o resto vão para /download", () => {
  assert.equal(
    nativeDownloadHref("Mozilla/5.0 (Linux; Android 14; Pixel 8)"),
    "/download",
  );
  assert.equal(
    nativeDownloadHref(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    ),
    "/download",
  );
});
