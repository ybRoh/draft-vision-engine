/* 도형 → PDF. **1:1 실물 크기** A4 분할 인쇄용.
 *
 * 패턴 PDF 의 존재 이유는 실물 크기로 뽑아 천 위에 얹는 것이다. 화면에 예쁘게 보이는
 * 것은 부차적이고, **자로 쟀을 때 도면 치수와 같아야** 한다. 그래서
 *   · 좌표를 pt 로만 환산해 넣고(1cm = 72/2.54 pt), 어떤 스케일도 걸지 않는다
 *   · 첫 장에 5cm 검정 사각형을 넣어 인쇄기가 축소했는지 사람이 바로 잴 수 있게 한다
 *   · 조각이 한 장을 넘으면 나눠 찍고 모서리 십자표로 이어 붙이게 한다
 *
 * 외부 라이브러리를 쓰지 않는다(리포 원칙: npm 의존성 0). DXF 와 같이 손으로 쓴다.
 *
 * ★ 한글: PDF 기본 14폰트(Helvetica 등)에는 한글 글리프가 없다. 한글을 그대로 넣으면
 *   깨진 글자가 찍힌다. 그래서 도면 안 글자는 ASCII 만 남기고 한글은 걷어낸다
 *   (점 이름·계산식은 대개 ASCII 다). 조각 이름 같은 한글 정보는 CLI 가 화면에 찍는다.
 */

const PT = 72 / 2.54;                 // 1cm → pt
const PAPER = { a4: [21.0, 29.7], a3: [29.7, 42.0], letter: [21.59, 27.94] };

/* 색 약속 (lib/svg.mjs 와 같다) — 검정=패턴·패턴명, 파랑=치수, 빨강=원형비교 */
const BLACK = [0.07, 0.07, 0.07], BLUE = [0.11, 0.31, 0.85], RED = [0.86, 0.15, 0.15];
const STYLE = {
  cut:          { rgb: BLACK, w: 0.9, dash: null },
  guide:        { rgb: BLACK, w: 0.35, dash: [3, 3] },
  fold:         { rgb: BLACK, w: 0.5, dash: [12, 3, 1.5, 3] },
  dart:         { rgb: BLACK, w: 0.6, dash: null },
  construction: { rgb: BLACK, w: 0.3, dash: [6, 3] },
  compare:      { rgb: RED, w: 0.4, dash: [5, 2.5] },
};

const f = (v) => (Math.round(v * 100) / 100);
/** PDF 문자열 리터럴 이스케이프 */
const pstr = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
/** 한글 등 비ASCII 를 걷어낸다. 기본 폰트에 글리프가 없어 넣으면 깨진다 */
export const asciiOnly = (s) => String(s ?? '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
export const hasNonAscii = (s) => /[^\x00-\x7F]/.test(String(s ?? ''));

/** 조각이 실제로 차지하는 범위 (완성선·다트·너치·치수선·비교패턴까지) */
function contentBox(d, 여백) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const 넣기 = (p) => {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  };
  for (const s of d.segments) for (const p of s.pts) 넣기(p);
  for (const c of d.compares ?? []) for (const l of c.lines) for (const p of l) 넣기(p);
  for (const dt of d.darts) { 넣기(dt.apex); 넣기(dt.leg1); 넣기(dt.leg2); }
  for (const n of d.notches) 넣기(n.at);
  for (const dm of d.dims ?? []) {
    const L = Math.hypot(dm.b[0] - dm.a[0], dm.b[1] - dm.a[1]) || 1;
    const nx = -(dm.b[1] - dm.a[1]) / L, ny = (dm.b[0] - dm.a[0]) / L;
    const o = dm.offset + Math.sign(dm.offset || 1) * 1.2;
    for (const p of [dm.a, dm.b]) 넣기([p[0] + nx * o, p[1] + ny * o]);
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0: x0 - 여백, y0: y0 - 여백, x1: x1 + 여백, y1: y1 + 여백 };
}

/**
 * @param drawing lib/draft.mjs resolve() 결과
 * @param opt.paper     a4 | a3 | letter
 * @param opt.landscape 가로 방향
 * @param opt.margin    인쇄 여백 cm (프린터가 못 찍는 가장자리)
 * @param opt.points    점·이름 표시
 * @param opt.title     첫 장에 적을 이름 (ASCII 만 남는다)
 * @returns {{buf: Buffer, pages: number, cols: number, rows: number, size: {w,h}}}
 */
export function toPDF(drawing, opt = {}) {
  const {
    paper = 'a4', landscape = false, margin = 1.0,
    points: showPts = true, title = drawing.name,
  } = opt;
  const P = PAPER[paper.toLowerCase()];
  if (!P) throw new Error(`모르는 용지 '${paper}' (a4, a3, letter)`);
  const [pw, ph] = landscape ? [P[1], P[0]] : P;
  const 폭 = pw - margin * 2, 높이 = ph - margin * 2;   // 찍을 수 있는 영역 (cm)
  if (!(폭 > 2 && 높이 > 2)) throw new Error(`여백 ${margin}cm 이 용지보다 크다`);

  const box = contentBox(drawing, 1.0);
  const W = box.x1 - box.x0, H = box.y1 - box.y0;
  const cols = Math.max(1, Math.ceil(W / 폭 - 1e-9));
  const rows = Math.max(1, Math.ceil(H / 높이 - 1e-9));

  /* ── 좌표 변환. 도면은 y 가 아래로 +, PDF 는 위로 + 라 뒤집는다. */
  const 만들기 = (ox, oy) => ({
    X: (x) => (margin + (x - ox)) * PT,
    Y: (y) => (ph - margin - (y - oy)) * PT,
  });

  const 조각 = [];   // 페이지별 content stream
  const 안내 = [];

  // ── 첫 장: 실물 크기 확인용 5cm 자 + 조립 안내
  {
    const g = 만들기(0, 0);
    const c = [];
    const 글 = (x, y, size, s) => c.push(`BT /F1 ${size} Tf ${f(x * PT)} ${f((ph - y) * PT)} Td (${pstr(s)}) Tj ET`);
    c.push(`${BLACK.join(' ')} rg ${BLACK.join(' ')} RG`);
    글(margin, margin + 1.0, 16, asciiOnly(title) || 'Pattern');
    글(margin, margin + 2.0, 10, '1:1 ACTUAL SIZE - print at 100% (no "fit to page")');
    글(margin, margin + 2.8, 10, `Sheets: ${cols} x ${rows} = ${cols * rows}   Paper: ${paper.toUpperCase()}${landscape ? ' landscape' : ''}`);
    글(margin, margin + 4.2, 11, 'CHECK BEFORE CUTTING: the square below must measure exactly 5.0 cm');
    // 5cm 정사각형
    const sx = margin, sy = margin + 5.0;
    c.push(`1.2 w ${f(sx * PT)} ${f((ph - sy - 5) * PT)} ${f(5 * PT)} ${f(5 * PT)} re S`);
    글(sx + 1.4, sy + 2.9, 11, '5 cm');
    글(margin, margin + 11.5, 10, 'Assemble: match the corner crosses of neighbouring sheets.');
    글(margin, margin + 12.5, 10, 'Sheet id (A1, B2 ...) is printed at the top-left of each sheet.');
    조각.push(c.join('\n'));
    안내.push('cal');
  }

  // ── 타일
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const ox = box.x0 + cIdx * 폭, oy = box.y0 + r * 높이;
      const g = 만들기(ox, oy);
      const c = [];
      const path = (pts, st) => {
        if (pts.length < 2) return;
        c.push(`${st.rgb.join(' ')} RG ${f(st.w)} w`);
        c.push(st.dash ? `[${st.dash.join(' ')}] 0 d` : '[] 0 d');
        c.push(`${f(g.X(pts[0][0]))} ${f(g.Y(pts[0][1]))} m`);
        for (let i = 1; i < pts.length; i++) c.push(`${f(g.X(pts[i][0]))} ${f(g.Y(pts[i][1]))} l`);
        c.push('S');
      };
      const 글 = (x, y, size, s, rgb = BLACK) => {
        const t = asciiOnly(s);
        if (!t) return;
        c.push(`${rgb.join(' ')} rg BT /F1 ${size} Tf ${f(g.X(x))} ${f(g.Y(y))} Td (${pstr(t)}) Tj ET`);
      };

      // 원형비교패턴은 패턴선보다 먼저 (나중에 그리면 완성선을 덮는다)
      for (const cmp of drawing.compares ?? []) for (const l of cmp.lines) path(l, STYLE.compare);
      for (const s of drawing.segments) path(s.pts, STYLE[s.layer] ?? STYLE.cut);
      for (const dt of drawing.darts) path([dt.leg1, dt.apex, dt.leg2], STYLE.dart);

      // 너치 — 작은 원
      c.push(`${BLACK.join(' ')} RG 0.6 w [] 0 d`);
      for (const n of drawing.notches) {
        const x = g.X(n.at[0]), y = g.Y(n.at[1]), rr = 0.18 * PT, k = rr * 0.5523;
        c.push(`${f(x + rr)} ${f(y)} m ${f(x + rr)} ${f(y + k)} ${f(x + k)} ${f(y + rr)} ${f(x)} ${f(y + rr)} c`
          + ` ${f(x - k)} ${f(y + rr)} ${f(x - rr)} ${f(y + k)} ${f(x - rr)} ${f(y)} c`
          + ` ${f(x - rr)} ${f(y - k)} ${f(x - k)} ${f(y - rr)} ${f(x)} ${f(y - rr)} c`
          + ` ${f(x + k)} ${f(y - rr)} ${f(x + rr)} ${f(y - k)} ${f(x + rr)} ${f(y)} c S`);
      }

      // 치수선 (파랑)
      for (const dm of drawing.dims ?? []) {
        const L = Math.hypot(dm.b[0] - dm.a[0], dm.b[1] - dm.a[1]) || 1;
        const nx = -(dm.b[1] - dm.a[1]) / L, ny = (dm.b[0] - dm.a[0]) / L;
        const a2 = [dm.a[0] + nx * dm.offset, dm.a[1] + ny * dm.offset];
        const b2 = [dm.b[0] + nx * dm.offset, dm.b[1] + ny * dm.offset];
        path([a2, b2], { rgb: BLUE, w: 0.35, dash: null });
        path([dm.a, a2], { rgb: BLUE, w: 0.25, dash: null });
        path([dm.b, b2], { rgb: BLUE, w: 0.25, dash: null });
        const mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
        글(mx, my + (dm.offset >= 0 ? 0.75 : -0.35), 7, `${dm.label} = ${f(dm.length)}`, BLUE);
      }

      if (showPts) {
        c.push(`${BLACK.join(' ')} rg`);
        for (const [id, p] of Object.entries(drawing.points)) {
          const x = g.X(p.x), y = g.Y(p.y);
          c.push(`${f(x - 0.7)} ${f(y - 0.7)} 1.4 1.4 re f`);
          글(p.x + 0.2, p.y - 0.2, 6.5, id);
        }
      }

      /* 조립용 모서리 십자표 + 시트 이름. 재단선 위에 겹치지 않게 가장자리에 둔다. */
      const 십자 = (px, py) => c.push(`${f(px - 8)} ${f(py)} m ${f(px + 8)} ${f(py)} l S`
        + ` ${f(px)} ${f(py - 8)} m ${f(px)} ${f(py + 8)} l S`);
      c.push('0.5 0.5 0.5 RG 0.5 w [] 0 d');
      const m0 = margin * PT, mw = (margin + 폭) * PT, mh0 = (ph - margin) * PT, mh1 = (ph - margin - 높이) * PT;
      십자(m0, mh0); 십자(mw, mh0); 십자(m0, mh1); 십자(mw, mh1);
      const id = String.fromCharCode(65 + cIdx) + (r + 1);
      c.push(`${BLACK.join(' ')} rg BT /F1 9 Tf ${f(m0 + 4)} ${f(mh0 - 12)} Td (${pstr(id)} / ${pstr(String.fromCharCode(65 + cols - 1) + rows)}) Tj ET`);
      조각.push(c.join('\n'));
      안내.push(id);
    }
  }

  // ── PDF 조립
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };     // 1-base 객체 번호

  const kidsRef = [];
  const contentRefs = 조각.map((s) => add(`<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`));
  const fontRef = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pagesRefIdx = objs.length + 조각.length + 1;            // Pages 객체는 Page 들 뒤에 온다
  for (const cr of contentRefs) {
    kidsRef.push(add(`<< /Type /Page /Parent ${pagesRefIdx} 0 R /MediaBox [0 0 ${f(pw * PT)} ${f(ph * PT)}]`
      + ` /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${cr} 0 R >>`));
  }
  const pagesRef = add(`<< /Type /Pages /Count ${kidsRef.length} /Kids [${kidsRef.map((k) => `${k} 0 R`).join(' ')}] >>`);
  const catalogRef = add(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);

  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogRef} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return {
    buf: Buffer.from(out, 'latin1'),
    pages: 조각.length, cols, rows,
    size: { w: W, h: H },
    sheets: 안내,
  };
}
