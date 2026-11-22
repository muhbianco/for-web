/* global console, process */
// Engenharia reversa do Discord (docs/voz/10 do muchat): só leitura, oculta IP/ID/token.
// Read-only parser for Discord's native voice log (discord-*-webrtc_*).
// Usage: node dlog.mjs <file> <mode> [pattern]
// Scrubs IPv4/IPv6, 17-20 digit snowflakes, long hex/base64 tokens before printing.
import fs from 'node:fs';

const [file, mode = 'sources', pattern] = process.argv.slice(2);
const raw = fs.readFileSync(file).toString('latin1');
// entries start with "[YYYY-MM-DD HH:MM:SS.mmm] [tid] (src:line): "
const re = /\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\] \[(\d+)\] \(([^):]+):(\d+)\): /g;
const entries = [];
let m, last = null;
while ((m = re.exec(raw))) {
  if (last) last.msg = raw.slice(last.end, m.index);
  last = { ts: m[1], tid: m[2], src: m[3], line: m[4], end: re.lastIndex };
  entries.push(last);
}
if (last) last.msg = raw.slice(last.end);

const scrub = (s) => s
  .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>')
  .replace(/\b[0-9a-f]{0,4}(:[0-9a-f]{0,4}){4,7}\b/gi, '<ip6>')
  .replace(/\b\d{17,20}\b/g, '<id>')
  .replace(/[A-Za-z0-9_-]{32,}/g, '<tok>')
  .replace(/\s+/g, ' ').trim();

if (mode === 'sources') {
  const c = new Map();
  for (const e of entries) c.set(e.src, (c.get(e.src) || 0) + 1);
  console.log('entries', entries.length, 'first', entries[0]?.ts, 'last', entries.at(-1)?.ts);
  for (const [k, v] of [...c].sort((a, b) => b[1] - a[1])) console.log(v, k);
} else if (mode === 'grep') {
  const rx = new RegExp(pattern, 'i');
  const seen = new Map();
  for (const e of entries) {
    const s = `${e.src}:${e.line} ${scrub(e.msg)}`;
    if (!rx.test(s)) continue;
    const key = s.replace(/-?\d+(\.\d+)?/g, '#');
    if (!seen.has(key)) seen.set(key, { n: 0, first: `${e.ts} ${s}` });
    seen.get(key).n++;
  }
  for (const v of seen.values()) console.log(`[x${v.n}] ${v.first.slice(0, Number(process.env.MAXLEN || 1500))}`);
} else if (mode === 'raw') {
  const rx = new RegExp(pattern, 'i');
  for (const e of entries) {
    const s = `${e.ts} ${e.src}:${e.line} ${scrub(e.msg)}`;
    if (rx.test(s)) console.log(s.slice(0, Number(process.env.MAXLEN || 1500)));
  }
} else if (mode === 'sessions') {
  for (const e of entries) {
    if (/engine\.cpp|connection|Connect|disconnect|destroy/i.test(e.src + e.msg) && /voice_connection|engine\.cpp|connection\.cpp/i.test(e.src))
      console.log(e.ts, e.src + ':' + e.line, scrub(e.msg).slice(0, 200));
  }
}
