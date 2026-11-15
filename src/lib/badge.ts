/** Minimal shields.io-style flat badge as SVG. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Approximate text width for 11px Verdana (what shields.io uses). */
function textWidth(s: string) {
  let w = 0;
  for (const ch of s) w += /[ilI.,:;'|!]/.test(ch) ? 3.5 : /[mwMW@]/.test(ch) ? 9.5 : /[A-Z0-9]/.test(ch) ? 7.5 : 6.5;
  return Math.ceil(w);
}

export function renderBadge(label: string, message: string, color = "#2f81f7") {
  const lw = textWidth(label) + 12;
  const mw = textWidth(message) + 12;
  const w = lw + mw;
  const l = esc(label);
  const m = esc(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${m}">
<title>${l}: ${m}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${esc(color)}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${l}</text><text x="${lw / 2}" y="14">${l}</text>
<text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${m}</text><text x="${lw + mw / 2}" y="14">${m}</text>
</g></svg>`;
}

/** 1234 → "1.2k", 1250000 → "1.3M" */
export function compact(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
