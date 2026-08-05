#!/usr/bin/env node
/* DXF 출력 검증 — "CAD 에서 열린다" 를 코드로 확인한다.
 * 여기서 놓치면 LibreCAD 를 열어 보고서야 알게 되고, 그때는 이유를 못 찾는다.
 *
 * 좌표 검사는 반드시 **ENTITIES 의 VERTEX 만** 골라서 한다.
 * 파일 전체에서 그룹코드 10/20 을 긁으면 $EXTMIN/$EXTMAX 헤더와 POLYLINE 더미 좌표(0.0)가
 * 섞여 들어와, y 부호 뒤집기를 통째로 없애도 검사가 통과해 버린다(실제로 그랬다).
 */
import fs from 'node:fs';
import { resolve } from '../lib/draft.mjs';
import { toDXF, parseDXF, DXF_LAYER } from '../lib/dxf.mjs';

let fail = 0;
const bad = (m) => { console.error('✖ ' + m); fail++; };
const near = (got, want, what, tol = 0.01) => {
  if (!(Math.abs(got - want) <= tol)) bad(`${what}: 기대 ${want} · 실제 ${got}`);
};

const spec = JSON.parse(fs.readFileSync(new URL('../examples/bunka-front.draft.json', import.meta.url)));
const d = resolve(spec);
const txt = toDXF(d, { labels: true });

// ── 파일 형식
if (!txt.includes('AC1009')) bad('$ACADVER 가 AC1009(R12) 가 아니다 — 리더가 파서를 못 고른다');
if (!/\r\n/.test(txt)) bad('줄바꿈이 CRLF 가 아니다 — 일부 CAM 이 거부한다');
if (!txt.trimEnd().endsWith('EOF')) bad('EOF 로 안 끝난다');
if (txt.includes('LWPOLYLINE')) bad('LWPOLYLINE 이 들어갔다 — R14 엔티티라 R12 선언 파일에서 거부된다');

// 짝 검사는 \r\n 이 아니라 **모든 줄바꿈**으로 쪼개야 한다.
// 값에 맨 \n 이 들어가면 파일이 통째로 어긋나는데, \r\n 으로만 쪼개면 그걸 못 본다.
const gAll = txt.split(/\r?\n/);
if (gAll[gAll.length - 1] === '') gAll.pop();
if (gAll.length % 2 !== 0) bad(`그룹코드/값 짝이 안 맞는다 (줄 ${gAll.length}개)`);
for (let i = 0; i < gAll.length; i += 2) {
  if (!/^\s*-?\d+\s*$/.test(gAll[i])) { bad(`${i + 1}번째 줄이 그룹코드가 아니다: ${JSON.stringify(gAll[i])}`); break; }
}

// ── 값에 개행이 섞여도 파일이 안 깨져야 한다 (도면 이름은 모델이 써넣는 문자열이다)
{
  const evil = toDXF({ ...d, name: '문화식 상의 원형\n앞판' }, { labels: false });
  const lines = evil.split(/\r?\n/).filter((_, i, a) => i < a.length - 1 || a[i] !== '');
  if (lines.length % 2 !== 0) bad('도면 이름의 개행이 그대로 나가 그룹코드/값 짝이 깨졌다');
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*-?\d+\s*$/.test(lines[i])) { bad('도면 이름의 개행이 뒤의 모든 코드/값을 밀어냈다 — 정화가 안 됐다'); break; }
  }
}

const p = parseDXF(txt);

// ── 테이블
if (!p.styles.includes('STANDARD')) bad('STYLE 테이블에 STANDARD 가 없다 — TEXT 가 통째로 안 그려진다');
for (const lt of ['CONTINUOUS', 'DOT', 'CENTER']) {
  if (!p.ltypes.some((l) => l.name === lt)) bad(`LTYPE 테이블에 ${lt} 가 없다`);
}
// LTYPE 의 40(무늬 전체 길이)은 49 요소들의 절대값 합이어야 한다 — 안 맞으면 리더마다 간격이 제각각
for (const lt of p.ltypes) {
  const sum = lt.elements.reduce((a, v) => a + Math.abs(v), 0);
  near(lt.pattern, sum, `LTYPE ${lt.name} 의 40(=${lt.pattern}) 이 |49| 합`, 1e-6);
}

// ── 레이어: 도면이 쓰는 레이어가 전부 테이블에 있어야 한다
const used = new Set(p.entities.map((e) => e.layer).filter(Boolean));
for (const l of used) {
  if (!p.layers.includes(l)) bad(`엔티티가 레이어 '${l}' 을 쓰는데 LAYER 테이블에 없다 — 리더가 파일을 거부한다`);
}
if (!p.layers.includes('0')) bad("LAYER 테이블에 예약 레이어 '0' 이 없다");
for (const key of ['cut', 'guide', 'fold', 'dart']) {
  if (!used.has(DXF_LAYER[key])) bad(`레이어 '${DXF_LAYER[key]}' 이 도면에 하나도 안 쓰였다 (예제가 바뀐 것 아닌가)`);
}

/* ── 레이어가 참조하는 선종류가 전부 LTYPE 테이블에 있는가
 *
 * 파일 첫머리에 규칙으로 적어 두고도 정작 COMPARE 가 정의 없는 DASHED 를 참조하고 있었다.
 * 위쪽 검사는 이름을 **하드코딩한 목록**으로만 봐서 이걸 놓쳤다. 실제 참조에서 훑어야 한다. */
{
  const defined = new Set(p.ltypes.map((l) => l.name));
  for (const l of p.layerDefs) {
    if (l.ltype && !defined.has(l.ltype)) {
      bad(`레이어 '${l.name}' 이 선종류 '${l.ltype}' 을 참조하는데 LTYPE 테이블에 없다`
        + ` — 리더가 파일을 거부한다 (정의된 것: ${[...defined].join(', ')})`);
    }
  }
}

/* ── ACI 7 금지
 *
 * 7 은 "검정 또는 흰색" 이라는 뜻이고, 그 자동 대비는 AutoCAD 계열만 구현한다.
 * FreeCAD 는 7 을 흰색으로 가져오므로 밝은 배경에서 선이 통째로 사라진다
 * (맥에서는 열리는데 윈도우 FreeCAD 에서 선이 안 보이던 원인). 검정은 250 으로 쓴다. */
for (const l of p.layerDefs) {
  if (l.color === 7) {
    bad(`레이어 '${l.name}' 의 색이 ACI 7 이다 — 배경에 따라 흰색으로 나와 선이 안 보인다. 검정은 250`);
  }
}

/* ── 섹션 구성 — BLOCKS 를 빼먹으면 ENTITIES 를 못 찾고 빈 도면으로 여는 리더가 있다 */
{
  const want = ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'];
  if (p.sections.join(',') !== want.join(',')) {
    bad(`섹션 구성이 ${p.sections.join(' → ') || '(없음)'} 이다 — R12 는 ${want.join(' → ')} 여야 한다`);
  }
}

/* ── AC1009 에 R2000+ 그룹코드가 섞이지 않았는가
 *
 * 370(선굵기)·420(트루컬러)·390 등은 R2000 부터 생긴 코드다. R12 선언 파일에 넣으면
 * 규격 위반이고, 테이블 항목 안의 모르는 코드에서 파싱을 접는 리더가 있다. */
for (const c of ['370', '420', '390', '100']) {
  if (p.codes.has(c)) bad(`AC1009 파일에 R2000+ 그룹코드 ${c} 가 들어 있다`);
}

/* ── VERTEX 는 전부 70 을 달고 나가야 한다 (없으면 정점으로 안 쳐 주는 엄격한 리더가 있다) */
{
  const missing = p.vertices.filter((v) => !v.has70).length;
  if (missing) bad(`VERTEX ${missing}개가 그룹코드 70 없이 나갔다 (전체 ${p.vertices.length})`);
}

// ── 엔티티 개수
const nPoly = p.entities.filter((e) => e.type === 'POLYLINE').length;
/* 치수선 하나가 POLYLINE 3개를 만든다 — 치수선 본체 + 완성선까지 이어 주는 보조선 둘. */
const nDim = (d.dims ?? []).length;
const wantPoly = d.segments.length + d.darts.length + nDim * 3;
if (nPoly !== wantPoly) {
  bad(`POLYLINE ${nPoly}개 · 기대 ${wantPoly}개 (선 ${d.segments.length} + 다트 ${d.darts.length} + 치수선 ${nDim}×3)`);
}
const nCircle = p.entities.filter((e) => e.type === 'CIRCLE').length;
if (nCircle !== d.notches.length) bad(`너치 CIRCLE ${nCircle}개 · 기대 ${d.notches.length}개`);
const nText = p.entities.filter((e) => e.type === 'TEXT').length;
const wantText = Object.keys(d.points).length + 1 + nDim;   // 점 이름 + 제목 + 치수 글자
if (nText !== wantText) bad(`TEXT ${nText}개 · 기대 ${wantText}개 (점 이름 + 제목 + 치수 ${nDim})`);
for (const e of p.entities.filter((x) => x.type === 'POLYLINE')) {
  if (!e.verts || e.verts < 2) bad(`POLYLINE(${e.layer}) 에 VERTEX 가 ${e.verts ?? 0}개뿐이다`);
}

/* ── 좌표: ENTITIES 의 VERTEX 만 골라 본다 */
function vertices(dxfText) {
  const g = dxfText.split(/\r?\n/);
  const out = [];
  let inEnt = false, section = null;
  for (let i = 0; i + 1 < g.length; i += 2) {
    const code = g[i].trim(), val = g[i + 1];
    if (code === '0' && val === 'SECTION') section = 'pending';
    else if (code === '2' && section === 'pending') { section = val; inEnt = val === 'ENTITIES'; }
    else if (code === '0' && val === 'ENDSEC') { section = null; inEnt = false; }
    else if (inEnt && code === '0' && val === 'VERTEX') {
      let x, y;
      for (let j = i + 2; j + 1 < g.length && g[j] !== '0'; j += 2) {
        if (g[j] === '10') x = Number(g[j + 1]);
        if (g[j] === '20') y = Number(g[j + 1]);
      }
      out.push([x, y]);
    }
  }
  return out;
}

const txtPlain = toDXF(d, { labels: false });   // 라벨은 도면 밖으로 삐져나가므로 좌표 검사에서 뺀다
const V = vertices(txtPlain);
if (V.length < 50) bad(`VERTEX 를 ${V.length}개밖에 못 찾았다 — 추출 로직이나 출력이 이상하다`);

/* 비교 기준은 d.bbox 가 아니라 **폴리라인으로 그려진 점들** 이다.
 * bbox 에는 그려지지 않는 보조점(SWL_T 등)이 들어 있어 정점 범위와 다르다. */
const drawn = [...d.segments.flatMap((s) => s.pts), ...d.darts.flatMap((x) => [x.leg1, x.apex, x.leg2])];
const dx0 = Math.min(...drawn.map((p) => p[0])), dx1 = Math.max(...drawn.map((p) => p[0]));
const dy0 = Math.min(...drawn.map((p) => p[1])), dy1 = Math.max(...drawn.map((p) => p[1]));

// cm→mm 배율: 정점의 x 범위가 그린 폭의 10배여야 한다
near(Math.max(...V.map((v) => v[0])) - Math.min(...V.map((v) => v[0])), (dx1 - dx0) * 10, 'VERTEX x 폭(mm)', 0.05);

/* y 뒤집기: 엔진에서 **아래쪽(y 큰 쪽)** 인 허리선이 DXF 에서는 **가장 작은 y** 여야 한다.
 * 부호만 보면 안 된다 — 도면에 y<0 인 보조점이 있으면 뒤집든 말든 통과한다. */
near(Math.min(...V.map((v) => v[1])), -dy1 * 10, 'VERTEX y 최소(= -그린범위 아래·10)', 0.05);
near(Math.max(...V.map((v) => v[1])), -dy0 * 10, 'VERTEX y 최대(= -그린범위 위·10)', 0.05);

// 허리선(엔진 y 가 가장 큰 선)이 정말 DXF 아래쪽에 있는지 한 번 더 못 박는다
{
  const waist = d.segments.find((s) => s.id === 'waist');
  const wy = -waist.pts[0][1] * 10;
  if (!(wy <= Math.min(...V.map((v) => v[1])) + 0.05)) {
    bad(`허리선이 DXF 에서 아래쪽이 아니다 (y=${wy}) — 상하 반전됐다`);
  }
}

// ── $EXTMIN/$EXTMAX 가 실제로 그린 것을 다 감싸는지 (제목·라벨은 bbox 밖에 그려진다)
{
  const g = txt.split(/\r?\n/);
  const at = (name) => {
    const i = g.indexOf(name);
    return { x: Number(g[g.indexOf('10', i) + 1]), y: Number(g[g.indexOf('20', i) + 1]) };
  };
  const mn = at('$EXTMIN'), mx = at('$EXTMAX');
  const Vl = vertices(txt);
  const xs = Vl.map((v) => v[0]), ys = Vl.map((v) => v[1]);
  if (mn.x > Math.min(...xs) + 1e-6) bad(`$EXTMIN.x(${mn.x}) 가 실제 정점 최소(${Math.min(...xs)}) 보다 크다 — Zoom Extents 에서 잘린다`);
  if (mx.x < Math.max(...xs) - 1e-6) bad(`$EXTMAX.x(${mx.x}) 가 실제 정점 최대(${Math.max(...xs)}) 보다 작다`);
  if (mn.y > Math.min(...ys) + 1e-6) bad(`$EXTMIN.y(${mn.y}) 가 실제 정점 최소(${Math.min(...ys)}) 보다 크다`);
  if (mx.y < Math.max(...ys) - 1e-6) bad(`$EXTMAX.y(${mx.y}) 가 실제 정점 최대(${Math.max(...ys)}) 보다 작다`);
  // 제목 TEXT 는 bbox 위쪽 밖에 그려진다 — 확장범위가 그걸 포함해야 한다
  if (!(mx.y >= -(d.bbox.y0 - 1.5) * 10 - 1e-6)) bad(`$EXTMAX.y(${mx.y}) 가 제목 TEXT 를 못 감싼다`);
}

/* ── labels 를 끄면 **점 이름** TEXT 가 빠져야 한다.
 * 치수 글자는 DIM 레이어라 labels 와 무관하게 남는다 — CAD 에서 고칠 때 공식을 봐야 하기
 * 때문이다. 그래서 DIM 레이어를 뺀 나머지만 센다. */
{
  const t = parseDXF(txtPlain).entities.filter((e) => e.type === 'TEXT' && e.layer !== DXF_LAYER.dim);
  if (t.length !== 1) bad(`--labels 없이도 점 이름이 나간다 (공장 전달용에 잡음) — DIM 밖 TEXT ${t.length}개`);
}
// title 을 끄면 DIM 밖 TEXT 가 아예 없어야 한다 (한글 제목을 못 읽는 CAM 용 탈출구)
if (parseDXF(toDXF(d, { labels: false, title: false })).entities
      .some((e) => e.type === 'TEXT' && e.layer !== DXF_LAYER.dim)) {
  bad('title:false 인데도 제목·점 이름 TEXT 가 나간다');
}

// ── parseDXF 가 SEQEND 를 넘어 정점을 주워 담지 않는지
{
  const fake = ['0', 'SECTION', '2', 'ENTITIES',
    '0', 'POLYLINE', '8', 'CUT', '0', 'VERTEX', '10', '0', '20', '0',
    '0', 'VERTEX', '10', '1', '20', '0', '0', 'SEQEND', '8', 'CUT',
    '0', 'VERTEX', '10', '9', '20', '9',              // SEQEND 뒤 떠돌이 정점
    '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
  const q = parseDXF(fake);
  const poly = q.entities.find((e) => e.type === 'POLYLINE');
  if (poly.verts !== 2) bad(`parseDXF 가 SEQEND 뒤 떠돌이 VERTEX 를 폴리라인에 붙였다 (verts=${poly.verts}, 기대 2)`);
}

console.log(fail ? `✖ verify_dxf: ${fail}건 실패`
  : `✔ verify_dxf (POLYLINE ${nPoly} · CIRCLE ${nCircle} · TEXT ${nText} · VERTEX ${V.length} · 레이어 ${[...used].join(',')})`);
process.exit(fail ? 1 : 0);
