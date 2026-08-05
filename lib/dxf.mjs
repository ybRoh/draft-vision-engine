/* 도형 → DXF R12(AC1009). 의존성 0.
 *
 * R12 를 고른 이유와 지켜야 할 규칙은 기존 패턴 엔진(새로운패턴메이킹/lib/jacketPattern.mjs)
 * 에서 이미 값을 치른 것들이다. 그대로 따른다:
 *   · LWPOLYLINE 금지 — R14 엔티티라 R12 선언 파일에 넣으면 LibreCAD·구형 CAM 이 거부한다.
 *     POLYLINE + VERTEX + SEQEND 를 쓴다.
 *   · STYLE 테이블이 없으면 TEXT 가 통째로 안 그려진다.
 *   · LTYPE 테이블에 없는 선종류를 레이어가 참조하면 파일이 거부된다.
 *   · LTYPE 의 40(무늬 전체 길이)은 49 요소들의 절대값 합이어야 한다.
 *   · TEXT 는 가운데 정렬 코드(72/11)를 쓰지 않는다 — 리더마다 지원이 갈려 글자가 사라진다.
 *   · DXF 는 y 가 **위**, 엔진은 y 가 아래 → 부호를 뒤집지 않으면 상하 반전된다.
 *
 * 여기서 추가로 지키는 것:
 *   · 값 문자열의 개행을 없앤다. DXF 는 줄 단위 포맷이라 값 안의 \n 하나가 뒤의 모든
 *     코드/값을 한 칸씩 밀어 파일 전체를 못 읽게 만든다. 도면 이름은 이미지를 읽은 모델이
 *     써넣는 문자열이므로 두 줄짜리 제목이 실제로 들어올 수 있다.
 *   · $EXTMIN/$EXTMAX 는 bbox 가 아니라 **실제로 그린 모든 점**에서 누적한다.
 *     제목·라벨·너치 원은 bbox 밖에 그려지므로 bbox 를 쓰면 Zoom Extents 에서 잘린다.
 */

/** 논리 레이어 → DXF 레이어 이름. R12 리더가 대문자로 정규화하는 경우가 있어 처음부터 대문자로 쓴다 */
export const DXF_LAYER = {
  cut: 'CUT', guide: 'GUIDE', fold: 'FOLD', dart: 'DART', construction: 'CONSTRUCTION',
  compare: 'COMPARE', notch: 'NOTCH', text: 'TEXT',
};
const LAYER_DEF = {
  CUT:          { color: 7, ltype: 'CONTINUOUS', lw: 50 },
  GUIDE:        { color: 8, ltype: 'DOT', lw: 13 },
  FOLD:         { color: 5, ltype: 'CENTER', lw: 18 },
  DART:         { color: 1, ltype: 'CONTINUOUS', lw: 25 },
  CONSTRUCTION: { color: 3, ltype: 'DOT', lw: 13 },
  COMPARE:      { color: 1, ltype: 'DASHED', lw: 13 },   // 원형비교패턴 = 빨강 가는 선
  NOTCH:        { color: 3, ltype: 'CONTINUOUS', lw: 25 },
  TEXT:         { color: 2, ltype: 'CONTINUOUS', lw: 18 },
};
/* STANDARD 폰트(txt.shx)의 글자폭 ÷ 높이 근사. 확장범위 계산에 쓴다. */
const CHAR_W = 0.62;

/** 도면 이름에 비ASCII 가 있으면 알려준다 — txt.shx 에는 한글 글리프가 없다 */
export const hasNonAscii = (s) => /[^\x00-\x7F]/.test(String(s ?? ''));

/**
 * @param drawing resolve() 결과
 * @param opt.scale      내부 cm → DXF 단위. 기본 10 (=mm)
 * @param opt.textHeight 글자 높이(mm)
 * @param opt.labels     점 이름을 TEXT 로 넣을지 (기본 false — 공장 전달용은 끄는 게 맞다)
 * @param opt.title      도면 이름 TEXT 를 넣을지 (기본 true).
 *                       한글 제목은 txt.shx 에 글리프가 없어 구형 CAM 에서 깨진다.
 *                       그런 환경으로 보낼 때는 false 로 끄면 되고, 이름은 999 주석에 남는다.
 */
export function toDXF(drawing, opt = {}) {
  const k = opt.scale ?? 10;
  const th = opt.textHeight ?? 8;
  const showTitle = opt.title !== false;
  const num = (v) => {
    if (!isFinite(v)) throw new Error(`DXF: 좌표가 숫자가 아니다 (${v})`);
    if (Math.abs(v) >= 1e15) throw new Error(`DXF: 좌표가 너무 크다 (${v}) — scale 을 확인하라`);
    return (Math.round(v * 1000) / 1000).toFixed(3);
  };
  /** 값 문자열 정화 — 개행이 들어가면 파일 전체가 어긋난다 */
  const s1 = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ');

  // ── 확장범위: 그리는 모든 점에서 누적한다 (DXF 좌표계 기준)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bump = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };

  const ENT = [];
  const e = (code, val) => { ENT.push(String(code)); ENT.push(String(val)); };
  const X = (p) => p[0] * k;
  const Y = (p) => -p[1] * k;      // y 뒤집기

  const poly = (pts, layer, closed = false) => {
    // 첫 점과 끝 점이 같으면 중복 정점 대신 closed 플래그로 닫는다.
    // 중복 정점은 CAM 에서 길이 0 이동·재절단을 만든다.
    let v = pts;
    if (v.length > 2) {
      const a = v[0], b = v[v.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) { v = v.slice(0, -1); closed = true; }
    }
    e(0, 'POLYLINE'); e(8, layer); e(66, 1); e(70, closed ? 1 : 0);
    e(10, '0.0'); e(20, '0.0'); e(30, '0.0');
    for (const p of v) {
      const x = X(p), y = Y(p); bump(x, y);
      e(0, 'VERTEX'); e(8, layer); e(10, num(x)); e(20, num(y)); e(30, '0.0');
    }
    e(0, 'SEQEND'); e(8, layer);
  };
  const circle = (c, r, layer) => {
    const x = X(c), y = Y(c);
    bump(x - r, y - r); bump(x + r, y + r);
    e(0, 'CIRCLE'); e(8, layer); e(10, num(x)); e(20, num(y)); e(30, '0.0'); e(40, num(r));
  };
  /* 그룹코드 순서는 R12 관례(8 · 10 20 30 · 40 · 1 · 50 · 7)를 따른다.
   * TEXT 는 왼쪽 아래를 삽입점으로 쓴다. */
  const text = (p, str, layer) => {
    const s = s1(str);
    const x = X(p), y = Y(p);
    bump(x, y); bump(x + s.length * th * CHAR_W, y + th);
    e(0, 'TEXT'); e(8, layer);
    e(10, num(x)); e(20, num(y)); e(30, '0.0');
    e(40, num(th)); e(1, s); e(50, '0.0'); e(7, 'STANDARD');
  };

  for (const s of drawing.segments) poly(s.pts, DXF_LAYER[s.layer] ?? DXF_LAYER.cut);
  for (const d of drawing.darts) poly([d.leg1, d.apex, d.leg2], DXF_LAYER.dart);
  for (const n of drawing.notches) circle(n.at, 0.25 * k, DXF_LAYER.notch);
  if (opt.labels) {
    for (const [id, p] of Object.entries(drawing.points)) text([p.x + 0.2, p.y - 0.2], id, DXF_LAYER.text);
  }
  const b = drawing.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  if (showTitle) text([b.x0, b.y0 - 1.5], drawing.name, DXF_LAYER.text);
  if (!isFinite(minX)) { minX = minY = maxX = maxY = 0; }   // 빈 도면

  // ── 조립
  const L = [];
  const g = (code, val) => { L.push(String(code)); L.push(String(val)); };

  g(999, s1(`${drawing.name} · units mm · DXF R12 (AC1009) · 제도인식엔진`));

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4);          // mm
  g(9, '$MEASUREMENT'); g(70, 1);       // 미터법
  g(9, '$TEXTSTYLE'); g(7, 'STANDARD');
  g(9, '$EXTMIN'); g(10, num(minX)); g(20, num(minY)); g(30, '0.0');
  g(9, '$EXTMAX'); g(10, num(maxX)); g(20, num(maxY)); g(30, '0.0');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
  // 40 은 49 요소들의 절대값 합이어야 한다 — 안 맞으면 리더마다 무늬 간격이 제각각이 된다
  g(0, 'LTYPE'); g(2, 'DOT'); g(70, 0); g(3, 'Dot . . . . .'); g(72, 65); g(73, 2);
  g(40, '3.000'); g(49, '0.500'); g(49, '-2.500');
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, 'Center ___ _ ___ _'); g(72, 65); g(73, 4);
  g(40, '20.000'); g(49, '12.500'); g(49, '-2.500'); g(49, '2.500'); g(49, '-2.500');
  g(0, 'ENDTAB');

  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, '0.0'); g(41, '1.0'); g(50, '0.0');
  g(71, 0); g(42, num(th)); g(3, 'txt'); g(4, '');
  g(0, 'ENDTAB');

  // 레이어 '0' 은 DXF 예약 레이어다. 대부분 리더가 자동 생성하지만 엄격한 CAM 은 아니다.
  const keys = ['0', ...Object.keys(LAYER_DEF)];
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, keys.length);
  for (const key of keys) {
    const def = LAYER_DEF[key] ?? { color: 7, ltype: 'CONTINUOUS', lw: 25 };
    g(0, 'LAYER'); g(2, key); g(70, 0); g(62, def.color); g(6, def.ltype);
    g(370, def.lw);                    // R12 는 무시, R2000+ 변환 시 살아난다
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  L.push(...ENT);
  g(0, 'ENDSEC');
  g(0, 'EOF');

  return L.join('\r\n') + '\r\n';
}

/** 아주 작은 DXF 되읽기 — 검증기가 "정말 들어갔나" 를 확인하는 용도 */
export function parseDXF(txt) {
  const lines = txt.split(/\r?\n/);
  const layers = [], entities = [], ltypes = [], styles = [];
  let section = null, table = null;
  let openPoly = null;              // SEQEND 로 닫히기 전의 POLYLINE
  let cur = null;                   // 마지막으로 연 LTYPE (49 요소를 받아 담는다)

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim(), val = lines[i + 1];
    if (code === '0') {
      if (val === 'SECTION') section = 'pending';
      else if (val === 'ENDSEC') { section = null; table = null; openPoly = null; }
      else if (val === 'TABLE') table = 'pending';
      else if (val === 'ENDTAB') table = null;
      else if (section === 'TABLES' && table === 'LAYER' && val === 'LAYER') layers.push({});
      else if (section === 'TABLES' && table === 'LTYPE' && val === 'LTYPE') { cur = { elements: [] }; ltypes.push(cur); }
      else if (section === 'TABLES' && table === 'STYLE' && val === 'STYLE') styles.push({});
      else if (section === 'ENTITIES') {
        if (val === 'VERTEX') {
          // 정점은 **아직 닫히지 않은** 폴리라인에만 붙는다.
          // 경계 없이 뒤로 훑으면 SEQEND 로 닫힌 폴리라인이 떠돌이 VERTEX 를 먹는다.
          if (openPoly) openPoly.verts++;
        } else if (val === 'SEQEND') {
          openPoly = null;
        } else {
          const ent = { type: val, verts: 0 };
          entities.push(ent);
          openPoly = val === 'POLYLINE' ? ent : null;
        }
      }
    } else if (code === '2') {
      if (section === 'pending') section = val;
      else if (table === 'pending') table = val;
      else if (section === 'TABLES' && table === 'LAYER' && layers.length) layers[layers.length - 1].name ??= val;
      else if (section === 'TABLES' && table === 'LTYPE' && ltypes.length) ltypes[ltypes.length - 1].name ??= val;
      else if (section === 'TABLES' && table === 'STYLE' && styles.length) styles[styles.length - 1].name ??= val;
      else if (section === 'ENTITIES' && entities.length) entities[entities.length - 1].name ??= val;
    } else if (code === '8' && section === 'ENTITIES' && entities.length) {
      const ent = entities[entities.length - 1];
      if (ent.layer === undefined) ent.layer = val;
    } else if (section === 'TABLES' && table === 'LTYPE' && cur) {
      if (code === '40') cur.pattern = Number(val);
      else if (code === '49') cur.elements.push(Number(val));
    }
  }
  return {
    layers: layers.map((l) => l.name).filter(Boolean),
    ltypes: ltypes.filter((l) => l.name),
    styles: styles.map((s) => s.name).filter(Boolean),
    entities,
  };
}
