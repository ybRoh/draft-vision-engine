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
  compare: 'COMPARE', notch: 'NOTCH', text: 'TEXT', dim: 'DIM',
};
/* 색은 ACI(AutoCAD Color Index) 번호다.
 *
 * ★ DXF 에는 배경색이 없다. 배경은 여는 쪽 프로그램이 정하고, 둘로 갈린다:
 *     오토캐드 2024 기본 = 어두움 (33,40,48)
 *     FreeCAD 기본       = 밝음
 *   그래서 "검정"도 "흰색"도 안전하지 않다. 한쪽에서 반드시 사라진다.
 *   실제로 두 번 다 이걸로 깨졌다:
 *     · ACI 7 → FreeCAD 가 흰색으로 가져온다. 밝은 배경에서 안 보임(윈도우 FreeCAD).
 *     · ACI 250 → 순수 검정(0,0,0). 어두운 배경에서 안 보임(오토캐드 2024).
 *       250 이 짙은 회색일 거라 짐작하고 골랐는데 실제 값은 검정이었다.
 *     · ACI 5(파랑, 0,0,255) 도 어두운 배경 대비 1.73 이라 치수선이 같이 사라졌다.
 *   7 은 "배경에 맞춰 뒤집어라" 라는 뜻이지만 그 자동 대비를 구현한 것은 AutoCAD 계열뿐이다.
 *
 * 그래서 **양쪽 배경 모두에서 살아남는 색**만 쓴다. 아래 대비값은 WCAG 명도대비이고
 * 어두운 배경·밝은 배경 각각에 대해 잰 뒤 나쁜 쪽을 적어 두었다. 2.5 미만은 쓰지 않는다.
 * (verify_dxf 가 이 표를 검사한다 — 색을 바꾸면 거기서 걸린다.)
 *
 * 규칙(사용자 지정)인 제도선=검정 · 치수=파랑 · 비교=빨강 중, 파랑과 빨강은 색상이라
 * 그대로 지킬 수 있다. "검정"만은 어두운 배경에서 불가능하므로 중간 회색으로 대신한다.
 * 인쇄용 흑백(진짜 검정)은 SVG·PDF 쪽이 담당한다. */
export const ACI_RGB = {
  8:   [128, 128, 128],   // 중간 회색 — 최악 대비 3.77. 제도선("검정" 대신)
  252: [102, 102, 102],   // 짙은 회색 — 최악 대비 2.59. 기초선·보조선(제도선보다 흐리게)
  150: [0, 127, 255],     // 밝은 파랑 — 최악 대비 3.83. 치수선·계산식
  1:   [255, 0, 0],       // 빨강     — 최악 대비 3.72. 원형비교패턴
};
const INK = 8, FAINT = 252, BLUE = 150, RED = 1;
const LAYER_DEF = {
  CUT:          { color: INK, ltype: 'CONTINUOUS' },
  GUIDE:        { color: FAINT, ltype: 'DOT' },          // 기초선 — 제도선보다 흐리게
  FOLD:         { color: INK, ltype: 'CENTER' },
  DART:         { color: INK, ltype: 'CONTINUOUS' },
  CONSTRUCTION: { color: FAINT, ltype: 'DOT' },          // 보조선
  COMPARE:      { color: RED, ltype: 'DASHED' },         // 원형비교패턴 = 빨강 가는 선
  DIM:          { color: BLUE, ltype: 'CONTINUOUS' },    // 치수선·계산식 = 파랑 가는 선
  NOTCH:        { color: INK, ltype: 'CONTINUOUS' },
  TEXT:         { color: INK, ltype: 'CONTINUOUS' },
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
  /* DXF R12(AC1009)는 유니코드 이전 규격이다. 한글을 UTF-8 바이트 그대로 넣으면
   * 리더가 글자를 깨뜨리는 정도가 아니라 **파일을 통째로 거부**하는 경우가 있다.
   * 그래서 기본으로 비ASCII 를 걷어낸다. 계산식의 수식 부분은 ASCII 라 그대로 남는다
   *   "B/4+여유분 1.5" → "B/4+1.5"
   * 쓰는 CAD 가 유니코드를 받는다면 unicode:true 로 원문을 넣을 수 있다. */
  const unicode = opt.unicode === true;
  const s1 = (s) => {
    let t = String(s ?? '').replace(/[\r\n]+/g, ' ');
    if (!unicode) t = t.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').replace(/([+\-*/(]) /g, '$1').replace(/^[+*\/\s]+/, '').trim();
    return t;
  };

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
      /* 70 을 빼면 안 된다. 없으면 0 으로 치는 리더가 대부분이지만, 값이 있어야만
       * 정점으로 인정하는 엄격한 리더가 있다. 2D 폴리라인 정점은 0 이다(32 는 3D). */
      e(0, 'VERTEX'); e(8, layer); e(10, num(x)); e(20, num(y)); e(30, '0.0'); e(70, 0);
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

  for (const c of drawing.compares ?? []) for (const pts of c.lines) poly(pts, DXF_LAYER.compare);
  for (const s of drawing.segments) poly(s.pts, DXF_LAYER[s.layer] ?? DXF_LAYER.cut);
  for (const d of drawing.darts) poly([d.leg1, d.apex, d.leg2], DXF_LAYER.dart);
  for (const n of drawing.notches) circle(n.at, 0.25 * k, DXF_LAYER.notch);

  /* 치수선과 계산식 — CAD 에서 고칠 때 "이 숫자가 어디서 나왔나" 를 볼 수 있어야 한다.
   * 값만 있으면 되짚을 수 없다. 별도 레이어(DIM)라 필요 없으면 통째로 끌 수 있다. */
  for (const dm of drawing.dims ?? []) {
    const L = Math.hypot(dm.b[0] - dm.a[0], dm.b[1] - dm.a[1]) || 1;
    const nx = -(dm.b[1] - dm.a[1]) / L, ny = (dm.b[0] - dm.a[0]) / L;
    const a2 = [dm.a[0] + nx * dm.offset, dm.a[1] + ny * dm.offset];
    const b2 = [dm.b[0] + nx * dm.offset, dm.b[1] + ny * dm.offset];
    poly([a2, b2], DXF_LAYER.dim);
    poly([dm.a, a2], DXF_LAYER.dim);          // 완성선에서 치수선까지 이어 주는 보조선
    poly([dm.b, b2], DXF_LAYER.dim);
    const mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
    text([mx, my + (dm.offset >= 0 ? 0.75 : -0.35)], `${dm.label} = ${dm.length.toFixed(2)}`, DXF_LAYER.dim);
  }
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
  /* 도면 한계도 도형에 맞춘다. 안 맞으면 리더가 기본 한계(가로 12 세로 9 인치 등)를
   * 그대로 쓰고, 우리 도형은 그 밖에 있어 화면에 아무것도 안 나온다. */
  g(9, '$LIMMIN'); g(10, num(minX)); g(20, num(minY));
  g(9, '$LIMMAX'); g(10, num(maxX)); g(20, num(maxY));
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');

  /* ── VPORT: 파일을 열었을 때의 **첫 화면**.
   *
   * 이게 없으면 리더가 자기 기본 화면(보통 원점 근처의 작은 영역)을 쓴다. 우리 도형은
   * y 가 -380 까지 내려가므로 그 화면 밖에 있고, 결과는 "파일은 열렸는데 화면이 텅 빔"
   * 이다 — 오토캐드 2024 에서 아무것도 안 나오던 원인. 도형 한가운데를 10% 여유와 함께
   * 잡아 두면 어느 리더에서든 열자마자 패턴이 화면에 들어온다.
   * R12 VPORT 는 필드를 다 채워야 한다 — 빠뜨리면 무시하는 리더가 있다. */
  const vw = Math.max(maxX - minX, 1), vh = Math.max(maxY - minY, 1);
  g(0, 'TABLE'); g(2, 'VPORT'); g(70, 1);
  g(0, 'VPORT'); g(2, '*ACTIVE'); g(70, 0);
  g(10, '0.0'); g(20, '0.0'); g(11, '1.0'); g(21, '1.0');                 // 화면 안에서의 위치
  g(12, num((minX + maxX) / 2)); g(22, num((minY + maxY) / 2));           // 보는 중심
  g(13, '0.0'); g(23, '0.0'); g(14, '1.0'); g(24, '1.0'); g(15, '1.0'); g(25, '1.0');
  g(16, '0.0'); g(26, '0.0'); g(36, '1.0'); g(17, '0.0'); g(27, '0.0'); g(37, '0.0');
  g(40, num(vh * 1.1)); g(41, num(vw / vh)); g(42, '50.0'); g(43, '0.0'); g(44, '0.0');
  g(50, '0.0'); g(51, '0.0'); g(71, 0); g(72, 100); g(73, 1); g(74, 3);
  g(75, 0); g(76, 0); g(77, 0); g(78, 0);
  g(0, 'ENDTAB');

  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 4);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
  // 40 은 49 요소들의 절대값 합이어야 한다 — 안 맞으면 리더마다 무늬 간격이 제각각이 된다
  g(0, 'LTYPE'); g(2, 'DOT'); g(70, 0); g(3, 'Dot . . . . .'); g(72, 65); g(73, 2);
  g(40, '3.000'); g(49, '0.500'); g(49, '-2.500');
  g(0, 'LTYPE'); g(2, 'CENTER'); g(70, 0); g(3, 'Center ___ _ ___ _'); g(72, 65); g(73, 4);
  g(40, '20.000'); g(49, '12.500'); g(49, '-2.500'); g(49, '2.500'); g(49, '-2.500');
  /* DASHED 는 COMPARE 레이어가 참조한다. 이게 빠져 있어서 위 주석의 규칙("LTYPE 에 없는
   * 선종류를 레이어가 참조하면 파일이 거부된다")을 파일 스스로 어기고 있었다. */
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed __ __ __ __'); g(72, 65); g(73, 2);
  g(40, '9.000'); g(49, '6.000'); g(49, '-3.000');
  g(0, 'ENDTAB');

  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, '0.0'); g(41, '1.0'); g(50, '0.0');
  g(71, 0); g(42, num(th)); g(3, 'txt'); g(4, '');
  g(0, 'ENDTAB');

  // 레이어 '0' 은 DXF 예약 레이어다. 대부분 리더가 자동 생성하지만 엄격한 CAM 은 아니다.
  const keys = ['0', ...Object.keys(LAYER_DEF)];
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, keys.length);
  for (const key of keys) {
    const def = LAYER_DEF[key] ?? { color: INK, ltype: 'CONTINUOUS' };
    /* 370(선굵기)은 R2000 부터 생긴 코드다. AC1009 선언 파일에 넣으면 규격 위반이고,
     * 테이블 항목 안의 모르는 코드에서 파싱을 접는 리더가 있다. R12 는 선굵기 개념이
     * 아예 없으므로 넣어 봐야 얻는 것도 없다. */
    g(0, 'LAYER'); g(2, key); g(70, 0); g(62, def.color); g(6, def.ltype);
  }
  g(0, 'ENDTAB');

  /* APPID: 확장데이터를 하나도 안 써도 ACAD 항목을 기대하는 리더가 있다 */
  g(0, 'TABLE'); g(2, 'APPID'); g(70, 1);
  g(0, 'APPID'); g(2, 'ACAD'); g(70, 0);
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  /* 빈 BLOCKS 섹션. 블록을 하나도 안 쓰더라도 R12 리더는 이 섹션이 있다고 가정하고
   * 읽는 것이 많다 — 없으면 ENTITIES 를 못 찾고 빈 도면으로 여는 구현이 있다. */
  g(0, 'SECTION'); g(2, 'BLOCKS');
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
  const sections = [], codes = new Set();
  let section = null, table = null;
  let openPoly = null;              // SEQEND 로 닫히기 전의 POLYLINE
  let cur = null;                   // 마지막으로 연 LTYPE (49 요소를 받아 담는다)
  const vertices = [];              // VERTEX 가 70 을 달고 나갔는지 확인용
  let curVertex = null;
  const vports = [];
  const header = { extMin: [0, 0], extMax: [0, 0] };
  let hvar = null;                  // 지금 읽고 있는 헤더 변수 이름

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim(), val = lines[i + 1];
    codes.add(code);
    if (code === '0') {
      if (val === 'SECTION') section = 'pending';
      else if (val === 'ENDSEC') { section = null; table = null; openPoly = null; }
      else if (val === 'TABLE') table = 'pending';
      else if (val === 'ENDTAB') table = null;
      else if (section === 'TABLES' && table === 'VPORT' && val === 'VPORT') vports.push({ center: [0, 0], height: 0 });
      else if (section === 'TABLES' && table === 'LAYER' && val === 'LAYER') layers.push({});
      else if (section === 'TABLES' && table === 'LTYPE' && val === 'LTYPE') { cur = { elements: [] }; ltypes.push(cur); }
      else if (section === 'TABLES' && table === 'STYLE' && val === 'STYLE') styles.push({});
      else if (section === 'ENTITIES') {
        if (val === 'VERTEX') {
          // 정점은 **아직 닫히지 않은** 폴리라인에만 붙는다.
          // 경계 없이 뒤로 훑으면 SEQEND 로 닫힌 폴리라인이 떠돌이 VERTEX 를 먹는다.
          if (openPoly) openPoly.verts++;
          curVertex = { has70: false }; vertices.push(curVertex);
        } else if (val === 'SEQEND') {
          openPoly = null; curVertex = null;
        } else {
          curVertex = null;
          const ent = { type: val, verts: 0 };
          entities.push(ent);
          openPoly = val === 'POLYLINE' ? ent : null;
        }
      }
    } else if (code === '2') {
      if (section === 'pending') { section = val; sections.push(val); }
      else if (table === 'pending') table = val;
      else if (section === 'TABLES' && table === 'LAYER' && layers.length) layers[layers.length - 1].name ??= val;
      else if (section === 'TABLES' && table === 'LTYPE' && ltypes.length) ltypes[ltypes.length - 1].name ??= val;
      else if (section === 'TABLES' && table === 'STYLE' && styles.length) styles[styles.length - 1].name ??= val;
      else if (section === 'ENTITIES' && entities.length) entities[entities.length - 1].name ??= val;
    } else if (code === '8' && section === 'ENTITIES' && entities.length) {
      const ent = entities[entities.length - 1];
      if (ent.layer === undefined) ent.layer = val;
    } else if (code === '9' && section === 'HEADER') {
      hvar = val.trim();
    } else if (section === 'HEADER' && hvar) {
      // $EXTMIN/$EXTMAX 의 10/20 만 받는다 — 열었을 때 화면 검사에 쓴다
      const slot = hvar === '$EXTMIN' ? header.extMin : hvar === '$EXTMAX' ? header.extMax : null;
      if (slot) { if (code === '10') slot[0] = Number(val); else if (code === '20') slot[1] = Number(val); }
    } else if (code === '70' && curVertex) {
      curVertex.has70 = true;
    } else if (section === 'TABLES' && table === 'VPORT' && vports.length) {
      const v = vports[vports.length - 1];
      if (code === '12') v.center[0] = Number(val);
      else if (code === '22') v.center[1] = Number(val);
      else if (code === '40') v.height = Number(val);
    } else if (section === 'TABLES' && table === 'LAYER' && layers.length) {
      // 레이어의 색(62)과 선종류(6) — 이걸 안 읽으면 "정의 안 된 선종류 참조" 를 못 잡는다
      const l = layers[layers.length - 1];
      if (code === '62') l.color ??= Number(val);
      else if (code === '6') l.ltype ??= val;
    } else if (section === 'TABLES' && table === 'LTYPE' && cur) {
      if (code === '40') cur.pattern = Number(val);
      else if (code === '49') cur.elements.push(Number(val));
    }
  }
  return {
    layers: layers.map((l) => l.name).filter(Boolean),
    layerDefs: layers.filter((l) => l.name),
    ltypes: ltypes.filter((l) => l.name),
    styles: styles.map((s) => s.name).filter(Boolean),
    entities, sections, vertices, codes, vports, header,
  };
}
