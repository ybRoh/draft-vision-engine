/* 도형 → SVG. 화면 확인 · 원본 사진 위 오버레이 비교용.
 * 좌표 그대로(cm, y 아래 +) 쓰고 viewBox 만 잡는다 → 오버레이에서 배율 맞추기가 쉽다.
 */

const STYLE = {
  cut:          { stroke: '#111', width: 0.09, dash: null },
  guide:        { stroke: '#888', width: 0.05, dash: '0.35 0.35' },
  fold:         { stroke: '#2563eb', width: 0.06, dash: '1.2 0.3 0.15 0.3' },
  dart:         { stroke: '#dc2626', width: 0.07, dash: null },
  construction: { stroke: '#16a34a', width: 0.05, dash: '0.6 0.3' },
};

const f = (v) => (Math.round(v * 1000) / 1000);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param drawing lib/draft.mjs resolve() 결과
 * @param opt.points  점·이름 표시 (기본 true)
 * @param opt.grid    1cm 모눈 (기본 true)
 * @param opt.margin  여백 cm
 */
export function toSVG(drawing, opt = {}) {
  const { points: showPts = true, grid = true, margin = 4 } = opt;
  const b = drawing.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  const x0 = b.x0 - margin, y0 = b.y0 - margin;
  const w = (b.x1 - b.x0) + margin * 2, h = (b.y1 - b.y0) + margin * 2;
  const out = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}"`
    + ` width="${f(w * 10)}mm" height="${f(h * 10)}mm" data-unit="cm"`
    + ` data-bbox="${f(b.x0)},${f(b.y0)},${f(b.x1)},${f(b.y1)}">`);
  out.push(`<title>${esc(drawing.name)}</title>`);
  out.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="#fff"/>`);

  if (grid) {
    const g = [];
    for (let x = Math.ceil(x0); x <= x0 + w; x++) g.push(`M${f(x)} ${f(y0)}V${f(y0 + h)}`);
    for (let y = Math.ceil(y0); y <= y0 + h; y++) g.push(`M${f(x0)} ${f(y)}H${f(x0 + w)}`);
    out.push(`<path d="${g.join('')}" stroke="#e5e7eb" stroke-width="0.02" fill="none"/>`);
  }

  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const s of drawing.segments) {
    const st = STYLE[s.layer] ?? STYLE.cut;
    const d = 'M' + s.pts.map((p) => `${f(p[0])} ${f(p[1])}`).join('L');
    out.push(`<path d="${d}" stroke="${st.stroke}" stroke-width="${st.width}"`
      + (st.dash ? ` stroke-dasharray="${st.dash}"` : '')
      + ` data-id="${esc(s.id)}" data-layer="${esc(s.layer)}" data-len="${f(s.length)}"><title>${esc(s.desc ?? "")} · ${f(s.length)}cm</title></path>`);
  }
  for (const d of drawing.darts) {
    out.push(`<path d="M${f(d.leg1[0])} ${f(d.leg1[1])}L${f(d.apex[0])} ${f(d.apex[1])}L${f(d.leg2[0])} ${f(d.leg2[1])}"`
      + ` stroke="${STYLE.dart.stroke}" stroke-width="${STYLE.dart.width}" data-id="${esc(d.id)}"><title>${esc(d.desc ?? "")} · 벌림 ${f(d.width)}cm</title></path>`);
  }
  out.push('</g>');

  for (const n of drawing.notches) {
    out.push(`<circle cx="${f(n.at[0])}" cy="${f(n.at[1])}" r="0.18" fill="none" stroke="#16a34a" stroke-width="0.06"><title>${esc(n.desc ?? "")}</title></circle>`);
  }

  if (showPts) {
    out.push('<g font-size="0.55" font-family="sans-serif" fill="#b91c1c">');
    for (const [id, p] of Object.entries(drawing.points)) {
      out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="0.11" fill="#b91c1c"/>`);
      out.push(`<text x="${f(p.x + 0.25)}" y="${f(p.y - 0.25)}">${esc(id)}<title>${esc(p.desc ?? "")}</title></text>`);
    }
    out.push('</g>');
  }

  // 5cm 검정 자 — 인쇄·오버레이 배율 확인용
  const rx = x0 + 0.6, ry = y0 + h - 0.9;
  out.push(`<g stroke="#111" stroke-width="0.07"><path d="M${f(rx)} ${f(ry)}h5M${f(rx)} ${f(ry - 0.3)}v0.6M${f(rx + 5)} ${f(ry - 0.3)}v0.6"/></g>`);
  out.push(`<text x="${f(rx)}" y="${f(ry - 0.5)}" font-size="0.5" font-family="sans-serif" fill="#111">5cm</text>`);

  out.push('</svg>');
  return out.join('\n');
}
