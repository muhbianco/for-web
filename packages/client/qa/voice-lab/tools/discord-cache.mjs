/* global console, process */
// Engenharia reversa do Discord (docs/voz/10 do muchat): só leitura.
// Procura um padrão nos bundles JS que o cliente desktop guarda em cache (Chromium
// blockfile: corpos em f_XXXXXX, comprimidos com brotli/gzip).
// Uso: node discord-cache.mjs "%APPDATA%\discord\Cache\Cache_Data" "vadLeading|vadTrailing" [contexto]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [dir, pattern, ctxArg] = process.argv.slice(2);
if (!dir || !pattern) {
  console.error('uso: node discord-cache.mjs <Cache_Data> <regex> [contexto]');
  process.exit(1);
}
const ctx = Number(ctxArg || 260);
const maxHits = Number(process.env.MAXHITS || 20);
let decoded = 0;
let hits = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.startsWith('f_')) continue;
  const raw = fs.readFileSync(path.join(dir, f));
  let text;
  for (const dec of [() => zlib.brotliDecompressSync(raw), () => zlib.gunzipSync(raw), () => raw]) {
    try {
      text = dec().toString('utf8');
      break;
    } catch {
      /* tenta o próximo formato */
    }
  }
  if (!text) continue;
  decoded++;
  const rx = new RegExp(`[\\s\\S]{0,${ctx}}(?:${pattern})[\\s\\S]{0,${ctx}}`, 'g');
  let m;
  while ((m = rx.exec(text)) && hits < maxHits) {
    hits++;
    console.log(`--- ${f} @${m.index}\n${m[0].replace(/\s+/g, ' ')}\n`);
  }
}
console.error(`${decoded} corpos lidos, ${hits} ocorrências`);
