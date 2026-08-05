/* 도형 → SVG. 화면 확인 · 원본 사진 위 오버레이 비교용.
 * 좌표 그대로(cm, y 아래 +) 쓰고 viewBox 만 잡는다 → 오버레이에서 배율 맞추기가 쉽다.
 */

/* 색 약속 (고정 규칙 — 바꾸지 말 것)
 *   검정  패턴 제도선 · 패턴명       (완성선·기초선·골선·다트·보조선, 굵기와 파선으로 구분)
 *   파랑  치수선 · 치수값 · 계산식   (가는 선)
 *   빨강  원형비교패턴               (가는 선 — 원형을 겹쳐 비교할 때만)
 * 패턴 자체는 한 가지 색으로 그린다. 색을 종류별로 흩뿌리면 무엇이 완성선이고 무엇이
 * 참고선인지 인쇄본(흑백)에서 구분이 안 된다. 구분은 굵기·파선으로 한다. */
const BLACK = '#111', BLUE = '#1d4ed8', RED = '#dc2626';
const STYLE = {
  cut:          { stroke: BLACK, width: 0.09, dash: null },
  guide:        { stroke: BLACK, width: 0.035, dash: '0.35 0.35' },
  fold:         { stroke: BLACK, width: 0.05, dash: '1.2 0.3 0.15 0.3' },
  dart:         { stroke: BLACK, width: 0.06, dash: null },
  construction: { stroke: BLACK, width: 0.03, dash: '0.6 0.3' },
  compare:      { stroke: RED,   width: 0.04, dash: '0.5 0.25' },
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
  // 액자는 viewBbox — 제도 보조선이 액자를 넓히지 못한다(lib/draft.mjs 참고)
  const b = drawing.viewBbox ?? drawing.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
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
    out.push(`<circle cx="${f(n.at[0])}" cy="${f(n.at[1])}" r="0.18" fill="none" stroke="${BLACK}" stroke-width="0.06"><title>${esc(n.desc ?? "")}</title></circle>`);
  }

  if (showPts) {
    out.push(`<g font-size="0.55" font-family="sans-serif" fill="${BLACK}">`);
    for (const [id, p] of Object.entries(drawing.points)) {
      out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="0.09" fill="${BLACK}"/>`);
      out.push(`<text x="${f(p.x + 0.25)}" y="${f(p.y - 0.25)}">${esc(id)}<title>${esc(p.desc ?? "")}</title></text>`);
    }
    out.push('</g>');
  }

  /* 치수선 — 교재 도면처럼 **식과 실측값을 같이** 적는다.
   * 값만 적으면 "이 23.0 이 어디서 나왔나" 를 못 되짚는다. 식이 보여야 사이즈를 바꿨을 때
   * 무엇이 따라 움직이는지 읽힌다. 글씨는 회전시키지 않는다 — 세로 치수선의 글자가 누우면
   * 인쇄본에서 읽기 어렵다. */
  if (drawing.dims?.length) {
    out.push(`<g stroke="${BLUE}" stroke-width="0.035" fill="none">`);
    for (const d of drawing.dims) {
      const [ax, ay] = d.a, [bx, by] = d.b;
      const L = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / L, ny = (bx - ax) / L;      // 수직 단위벡터
      const o = d.offset;
      const a2 = [ax + nx * o, ay + ny * o], b2 = [bx + nx * o, by + ny * o];
      const t = [(bx - ax) / L, (by - ay) / L];
      const tick = 0.22;
      out.push(`<path d="M${f(a2[0])} ${f(a2[1])}L${f(b2[0])} ${f(b2[1])}`
        // 화살촉 대신 45° 짧은 빗금 — 작은 치수에서도 뭉개지지 않는다
        + `M${f(a2[0] - (t[0] - nx) * tick)} ${f(a2[1] - (t[1] - ny) * tick)}L${f(a2[0] + (t[0] - nx) * tick)} ${f(a2[1] + (t[1] - ny) * tick)}`
        + `M${f(b2[0] - (t[0] - nx) * tick)} ${f(b2[1] - (t[1] - ny) * tick)}L${f(b2[0] + (t[0] - nx) * tick)} ${f(b2[1] + (t[1] - ny) * tick)}`
        // 완성선에서 치수선까지 이어 주는 보조선
        + `M${f(ax)} ${f(ay)}L${f(a2[0] + nx * 0.25)} ${f(a2[1] + ny * 0.25)}`
        + `M${f(bx)} ${f(by)}L${f(b2[0] + nx * 0.25)} ${f(b2[1] + ny * 0.25)}"`
        + ` stroke-dasharray="none" data-id="${esc(d.id)}"><title>${esc(d.desc ?? '')} · ${esc(d.label)} = ${f(d.length)}cm</title></path>`);
    }
    out.push('</g>');
    out.push(`<g font-size="0.6" font-family="sans-serif" fill="${BLUE}" text-anchor="middle">`);
    for (const d of drawing.dims) {
      const [ax, ay] = d.a, [bx, by] = d.b;
      const L = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / L, ny = (bx - ax) / L;
      const mx = (ax + bx) / 2 + nx * d.offset, my = (ay + by) / 2 + ny * d.offset;
      // 글자가 치수선 위에 얹히지 않게 살짝 띄운다
      const side = d.offset >= 0 ? 1 : -1;
      out.push(`<text x="${f(mx)}" y="${f(my + side * 0.75)}">`
        + `${esc(d.label)}<tspan fill="${BLUE}" opacity="0.65"> = ${f(d.length)}</tspan></text>`);
    }
    out.push('</g>');
  }

  // 패턴명 — 검정 (색 약속)
  out.push(`<text x="${f(b.x0)}" y="${f(b.y0 - 1.4)}" font-size="0.9" font-family="sans-serif"`
    + ` fill="${BLACK}" font-weight="600">${esc(drawing.name)}</text>`);

  // 5cm 검정 자 — 인쇄·오버레이 배율 확인용
  const rx = x0 + 0.6, ry = y0 + h - 0.9;
  out.push(`<g stroke="#111" stroke-width="0.07"><path d="M${f(rx)} ${f(ry)}h5M${f(rx)} ${f(ry - 0.3)}v0.6M${f(rx + 5)} ${f(ry - 0.3)}v0.6"/></g>`);
  out.push(`<text x="${f(rx)}" y="${f(ry - 0.5)}" font-size="0.5" font-family="sans-serif" fill="#111">5cm</text>`);

  out.push('</svg>');
  return out.join('\n');
}
