WASM and ONNX model for DeepFilterNet3, committed and pinned by SHA-256 in
`scripts/verify-noise-suppression-assets.mjs` (the build fails on any
mismatch). The CDN they used to be downloaded from answers 403 since
2026-11-13, and the WASM is published nowhere else.

The model is a `.tar.gz` that libDF opens with a gzip decoder. Static servers
that label `*.gz` as `Content-Encoding: gzip` (sirv does) make the browser
hand over a plain tar; `components/rtc/deepFilterModel.ts` re-gzips it.
