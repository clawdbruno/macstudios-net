#!/usr/bin/env node
/* ============================================================================
 * SEO page + embed widget generator for macstudios.net
 *
 * Extracts the dataset from index.html (single source of truth) by slicing the
 * const declarations between stable banners, evaluates them in a sandbox, and
 * emits:
 *   run/<model-slug>.html   — one indexable page per model ("Cheapest way to run X on a Mac")
 *   embed.html              — iframe-able widget with per-model top-5 tables baked in
 *   sitemap.xml             — root + all generated pages
 *
 * Pure Node (no DOM, no deps) so the monthly refresh routine can run it anywhere:
 *     node build-seo.mjs
 *
 * The small math helpers below are deliberate duplicates of the in-page versions —
 * if you change footprint/speed math in index.html, mirror it here (diagnostics on
 * the site catch data drift; this comment is the sync contract for the math).
 * ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const SITE = 'https://macstudios.net';
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// ---- extract data consts from the page ----
function slice(startMarker, endMarker){
  const a = html.indexOf(startMarker);
  if(a === -1) throw new Error('start marker not found: '+startMarker);
  const b = html.indexOf(endMarker, a);
  if(b === -1) throw new Error('end marker not found: '+endMarker);
  return html.slice(a, b + endMarker.length);
}
const dataJS = [
  slice('/* ===================== DATA: Mac Studio configurations', 'macStudios.forEach((m,i)=>m.id=i);'),
  slice('const llms = [', '\n];'),
  slice('const CONTEXT_ARCH = {', '\n};'),
  slice('const CLOUD_PRICE_OUT_PER_M = {', '\n};'),
  slice('const ROUGH_FX_FROM_USD', ';'),
  slice('const OLLAMA_ID = {', '\n};'),
  slice('const QUALITY = {', '\n};'),
  slice('const MODEL_RELEASED = {', '\n};'),
  slice('const QUANTS = [', '\n];'),
  slice('const CURRENCY = {', '\n};'),
  slice('const PRICE_MULTIPLIER = {', '\n};'),
  slice('const POWER_BY_CHIP = {', '\n};'),
  slice('const CURRENT_HIKE = {', '\n};'),
  slice('const REMOVED_TIERS_2026 = [', '\n];'),
  slice('const REFURB_DISCOUNT_BY_GEN', ';'),
  slice('const USED_MARKET_RANGE_BY_GEN = {', '\n};'),
].join('\n');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(dataJS + `
  __out = { macStudios, llms, CONTEXT_ARCH, CLOUD_PRICE_OUT_PER_M, ROUGH_FX_FROM_USD,
    OLLAMA_ID, QUALITY, MODEL_RELEASED, QUANTS, CURRENCY, PRICE_MULTIPLIER,
    POWER_BY_CHIP, CURRENT_HIKE, REMOVED_TIERS_2026, REFURB_DISCOUNT_BY_GEN,
    USED_MARKET_RANGE_BY_GEN };
`, ctx);
const D = ctx.__out;
console.log(`extracted: ${D.macStudios.length} machines, ${D.llms.length} models`);

// ---- math (sync contract with index.html) ----
const footprintGB = (paramsB, bytes) => paramsB * bytes * 1.12;
const tokensPerSec = (bw, llm, bytes) => 0.48 * bw / ((llm.activeB || llm.paramsB) * bytes);
const fmtTok = t => t >= 10 ? Math.round(t) + ' tok/s' : t.toFixed(1) + ' tok/s';
const maxCtx = (ramGB, llm, weightsGB) => {
  const arch = D.CONTEXT_ARCH[llm.name];
  const remaining = ramGB * 0.75 - weightsGB;
  if(remaining <= 0) return '—';
  const tokens = Math.min(Math.floor(remaining * 1e9 / (arch.kvKB * 1024)), arch.maxCtxK * 1000);
  const k = tokens / 1000;
  return (k >= 1000 ? (k/1000).toFixed(1) + 'M' : Math.round(k) + 'K') + ' tokens';
};
const isCurrentlySold = m =>
  (m.family === 'Studio' && m.gen === '2025') ||
  (m.family === 'Mac mini' && m.gen === '2024') ||
  (m.family === 'MacBook Pro' && (m.gen === '2025' || m.gen === '2026'));
const usedPrice = m => {
  const r = D.USED_MARKET_RANGE_BY_GEN[m.gen];
  return Math.round(m.price * (r.low + r.high) / 2);
};
const fmtUSD = n => '$' + Math.round(n).toLocaleString('en-US');
const label = m => `${m.family === 'Studio' ? 'Mac Studio' : m.family} ${m.chip} ${m.cpu}c/${m.gpu}c ${m.ram}GB (${m.gen})`;
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const q4 = D.QUANTS.find(q => q.key === 'q4');
const bestQuantFor = (m, llm) =>
  D.QUANTS.slice(0, D.QUANTS.findIndex(q => q.key === 'q4') + 1)
    .find(q => footprintGB(llm.paramsB, q.bytes) <= m.ram * 0.75) || null;

// ---- per-model computation (used-market pricing: what a buyer pays today) ----
function dealRows(llm){
  return D.macStudios.map(m => {
    if(footprintGB(llm.paramsB, q4.bytes) > m.ram * 0.75) return null;
    const quant = bestQuantFor(m, llm);
    const price = usedPrice(m);
    const tok = tokensPerSec(m.bw, llm, quant.bytes);
    return { m, quant, price, tok, ctx: maxCtx(m.ram, llm, llm.paramsB * quant.bytes) };
  }).filter(Boolean).sort((a, b) => a.price - b.price);
}

const CSS = `*{box-sizing:border-box;margin:0}body{font-family:-apple-system,'Segoe UI',sans-serif;background:#f4f1ea;color:#181611;line-height:1.55;padding:32px 20px}main{max-width:820px;margin:0 auto}.rule{height:8px;background:#e8490f;margin:-32px -20px 28px}.eyebrow{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#c43a05;margin-bottom:14px}h1{font-size:34px;line-height:1.1;letter-spacing:-.02em;margin-bottom:10px}h2{font-size:20px;margin:28px 0 8px}.sub{color:#6f6a5b;margin-bottom:18px}.hero{background:#fdfcf8;border:1px solid #181611;border-left:5px solid #e8490f;padding:18px;margin:18px 0}.hero b{font-size:19px}table{width:100%;border-collapse:collapse;font-size:13.5px;margin:12px 0;background:#fdfcf8;border:1px solid #d6d0c0}th{font-family:ui-monospace,monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;text-align:left;color:#6f6a5b;padding:8px 10px;border-bottom:2px solid #181611}td{padding:8px 10px;border-bottom:1px solid #e4dfd2;font-variant-numeric:tabular-nums}.est{font-size:9px;font-family:ui-monospace,monospace;color:#9a6b00;background:#f3e8cf;padding:1px 4px;vertical-align:middle}code{font-family:ui-monospace,monospace;background:#ece8dd;padding:2px 7px;font-size:13px}.cta{display:inline-block;background:#e8490f;color:#fff;text-decoration:none;padding:11px 20px;font-weight:700;margin:10px 0}a{color:#c43a05}.foot{margin-top:34px;padding-top:14px;border-top:1px solid #d6d0c0;font-size:12.5px;color:#6f6a5b}`;

mkdirSync(new URL('./run/', import.meta.url), { recursive: true });
const embedData = {};
const pageUrls = [];

for(const llm of D.llms){
  const slug = slugify(llm.name);
  const rows = dealRows(llm);
  const Q = D.QUALITY[llm.name];
  const cloud = D.CLOUD_PRICE_OUT_PER_M[llm.name];
  const moe = llm.activeB ? ` It is a mixture-of-experts model: all ${llm.paramsB}B parameters must sit in memory, but only ${llm.activeB}B compute per token, which is why it is faster than dense models of similar size.` : '';
  const cheapest = rows[0];
  embedData[slug] = { name: llm.name, rows: rows.slice(0, 5).map(r => ({ l: label(r.m), p: r.price, q: r.quant.label, t: fmtTok(r.tok) })) };
  pageUrls.push(`${SITE}/run/${slug}`);

  // Q3 fallback: a model that misses Q4 everywhere may still squeeze onto the biggest
  // machines at Q3_K_M (last-resort quality) — say so rather than a flat "no single Mac".
  const q3 = D.QUANTS.find(q => q.key === 'q3');
  const q3Fits = !cheapest ? D.macStudios
    .filter(m => footprintGB(llm.paramsB, q3.bytes) <= m.ram * 0.75)
    .map(m => ({ m, price: usedPrice(m), tok: tokensPerSec(m.bw, llm, q3.bytes) }))
    .sort((a, b) => a.price - b.price)[0] : null;

  const heroHtml = cheapest
    ? `<p>The cheapest Mac that runs ${llm.name} comfortably is a <b>used ${label(cheapest.m)}</b> at about <b>${fmtUSD(cheapest.price)}</b> <span class="est">EST.</span> on the used market — running ${cheapest.quant.label} quantization at roughly <b>${fmtTok(cheapest.tok)}</b> with up to ${cheapest.ctx} of context.</p>`
    : q3Fits
    ? `<p><b>${llm.name} only just fits a single Mac</b>: a <b>used ${label(q3Fits.m)}</b> (~${fmtUSD(q3Fits.price)} <span class="est">EST.</span>) can hold it at Q3_K_M — last-resort quantization quality — at roughly <b>${fmtTok(q3Fits.tok)}</b>. For Q4-or-better quality it needs ≈${footprintGB(llm.paramsB, q4.bytes).toFixed(0)}GB resident: a multi-machine cluster${cloud != null ? `, or a cloud API at about $${cloud}/1M output tokens` : ''}.</p>`
    : `<p><b>No single Mac can hold ${llm.name}</b> at practical quantizations — it needs ≈${footprintGB(llm.paramsB, q4.bytes).toFixed(0)}GB resident. Running it locally means clustering multiple machines (see the cluster planner on the main site), or using a cloud API${cloud != null ? ` at about $${cloud}/1M output tokens` : ''}.</p>`;

  const tableHtml = rows.length ? `<h2>Every Mac that runs it, by used price</h2>
  <table><thead><tr><th>Machine</th><th>Used price</th><th>Runs at</th><th>Est. speed</th><th>Max context</th></tr></thead><tbody>
  ${rows.slice(0, 10).map(r => `<tr><td>${label(r.m)}</td><td>${fmtUSD(r.price)} <span class="est">EST.</span></td><td>${r.quant.label}</td><td>${fmtTok(r.tok)}</td><td>${r.ctx}</td></tr>`).join('\n  ')}
  </tbody></table>
  ${rows.length > 10 ? `<p><a href="${SITE}/#panel=value&dlm=${encodeURIComponent(llm.name)}">See all ${rows.length} machines, other price bases, and live currency conversion →</a></p>` : ''}` : '';

  const faq = [
    { q: `What is the cheapest Mac to run ${llm.name}?`,
      a: cheapest ? `A used ${label(cheapest.m)} at roughly ${fmtUSD(cheapest.price)} runs ${llm.name} at ${cheapest.quant.label} quantization, generating about ${fmtTok(cheapest.tok)}.`
                  : `No single Mac holds ${llm.name} at practical quantizations; a multi-machine cluster or cloud API is required.` },
    { q: `How much RAM does ${llm.name} need?`,
      a: `About ${footprintGB(llm.paramsB, q4.bytes).toFixed(0)}GB resident at Q4_K_M quantization (weights plus overhead), so a machine needs roughly ${Math.ceil(footprintGB(llm.paramsB, q4.bytes) / 0.75)}GB of unified memory to run it comfortably.` },
    { q: `How good is ${llm.name}?`,
      a: `It scores ${Q.q} on the general intelligence index (Artificial Analysis scale) and ${Q.c} on the coding scale (SWE-bench)${Q.v ? ', from published benchmarks' : ', interpolated from published benchmark relationships'}.` },
  ];

  const page = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cheapest Mac to run ${llm.name} locally (2026) — macstudios.net</title>
<meta name="description" content="${cheapest ? `The cheapest way to run ${llm.name} on Apple Silicon: a used ${label(cheapest.m)} at ~${fmtUSD(cheapest.price)}, ${fmtTok(cheapest.tok)} at ${cheapest.quant.label}. Every Mac compared.` : `${llm.name} needs ≈${footprintGB(llm.paramsB, q4.bytes).toFixed(0)}GB resident — what it takes to run it locally on Apple Silicon.`}">
<link rel="canonical" href="${SITE}/run/${slug}">
<meta property="og:title" content="Cheapest Mac to run ${llm.name} locally">
<meta property="og:image" content="${SITE}/og-image.png">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) })}</script>
<style>${CSS}</style></head><body><div class="rule"></div><main>
<div class="eyebrow"><a href="${SITE}/" style="text-decoration:none;color:#c43a05;">MACSTUDIOS.NET</a> · Field Guide · Data verified Jul 2026</div>
<h1>Cheapest Mac to run ${llm.name}</h1>
<p class="sub">${llm.paramsB}B parameters${llm.activeB ? ` (${llm.activeB}B active)` : ''} · quality index ${Q.q} · coding ${Q.c} · every Apple Silicon Mac ever sold, compared.${moe}</p>
<div class="hero">${heroHtml}</div>
${tableHtml}
<h2>Run it</h2>
<p><code>ollama run ${D.OLLAMA_ID[llm.name]}</code> pulls the default (≈Q4) build once you have <a href="https://ollama.com">Ollama</a> installed.</p>
${cloud != null ? `<h2>Or skip the hardware</h2><p>Cloud APIs serve ${llm.name} at about <b>$${cloud} per million output tokens</b>. The main site's break-even solver computes the daily usage where owning a Mac becomes cheaper than renting.</p>` : ''}
<a class="cta" href="${SITE}/#panel=value&dlm=${encodeURIComponent(llm.name)}">Open the interactive guide — speed simulator, TCO, all 75 machines →</a>
<div class="foot">Estimates: used prices are market ballparks, speeds are bandwidth-model estimates (±30%) calibrated against llama.cpp benchmarks — the <a href="${SITE}/#panel=methodology">methodology</a> documents every formula. Computed from the same dataset as the live tool.</div>
</main></body></html>`;
  writeFileSync(new URL(`./run/${slug}.html`, import.meta.url), page);
}

// ---- embed widget ----
const embed = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>macstudios.net embed</title><meta name="robots" content="noindex">
<style>${CSS}body{padding:14px}main{max-width:none}</style></head><body><main>
<div class="eyebrow">CHEAPEST MAC FOR <span id="mname">…</span></div>
<table><thead><tr><th>Machine</th><th>Used ~</th><th>Quant</th><th>Speed</th></tr></thead><tbody id="rows"></tbody></table>
<div style="font-size:11.5px;color:#6f6a5b;">est. prices/speeds · <a id="src" href="${SITE}/" target="_blank">full guide at macstudios.net</a></div>
<script>
const DATA = ${JSON.stringify(embedData)};
const slug = new URLSearchParams(location.search).get('model') || 'qwen3-6-27b';
const d = DATA[slug];
if(d){
  document.getElementById('mname').textContent = d.name;
  document.getElementById('src').href = '${SITE}/run/' + slug;
  document.getElementById('rows').innerHTML = d.rows.length
    ? d.rows.map(r => '<tr><td>' + r.l + '</td><td>$' + r.p.toLocaleString() + '</td><td>' + r.q + '</td><td>' + r.t + '</td></tr>').join('')
    : '<tr><td colspan="4">Needs a multi-Mac cluster — see the full guide.</td></tr>';
}
</script></main></body></html>`;
writeFileSync(new URL('./embed.html', import.meta.url), embed);

// ---- sitemap ----
const today = new Date().toISOString().slice(0, 10);
writeFileSync(new URL('./sitemap.xml', import.meta.url),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>
${pageUrls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`).join('\n')}
</urlset>
`);
console.log(`wrote ${D.llms.length} pages + embed.html + sitemap.xml`);
