#!/usr/bin/env node
/* DSL → SVG + DXF.
 *
 *   node tools/render.mjs examples/bunka-front.draft.json
 *   node tools/render.mjs examples/bunka-front.draft.json --set B=92 --set WL=39
 *   node tools/render.mjs examples/bunka-front.draft.json --set SH_ANGLE=20
 *   node tools/render.mjs out/p128.draft.json --out out/p128 --labels
 */
import fs from 'node:fs';
import path from 'node:path';
import { DraftError } from '../lib/draft.mjs';
import { loadDraft } from '../lib/project.mjs';
import { ExprError } from '../lib/expr.mjs';
import { toSVG } from '../lib/svg.mjs';
import { toDXF } from '../lib/dxf.mjs';

const USAGE = [
  '사용법: node tools/render.mjs <draft.json> [--out 경로] [--set 이름=값]... [--labels] [--no-points]',
  '  --out       내보낼 파일 이름(확장자 없이). 기본값은 out/<입력파일이름>',
  '  --set       치수(measures)뿐 아니라 params(어깨경사·여유분 등)도 덮어쓴다.',
  '              예: --set B=92 --set SH_ANGLE=20 --set DART_W=3',
  '  --labels    DXF 에 점 이름을 글자로 넣는다',
  '  --no-points SVG 에서 점을 그리지 않는다',
  '  --no-title  DXF 에 도면 이름을 넣지 않는다. R12 STANDARD 폰트(txt.shx)에는 한글 글리프가',
  '              없어 한글 제목은 구형 CAM 에서 깨진다 — 그럴 때 끈다(이름은 999 주석에 남는다)',
].join('\n');

/* 플래그가 값을 받는지 적어 둔 표. 값을 받는 플래그 뒤 토큰은 입력 파일이 아니라 그 플래그의 값이다.
 * 이 표가 없으면 `--out out/zz 도면.json` 에서 'out/zz' 가 입력 파일로 잡힌다. */
const ARITY = { out: 1, set: 1, labels: 0, 'no-points': 0, 'no-title': 0 };

/** 인자를 플래그와 나머지(파일 이름)로 가른다. `--이름 값` 과 `--이름=값` 을 둘 다 받는다. */
function parseArgs(argv, arity) {
  const opts = Object.create(null);   // 이름 → 값 배열 (값 없는 플래그는 true)
  const rest = [];
  const known = Object.keys(arity).map((n) => `--${n}`).join(', ');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (!Object.hasOwn(arity, name)) die2(`모르는 플래그 '--${name}' (쓸 수 있는 것: ${known})`);
    let v;
    if (arity[name] === 0) {
      if (eq >= 0) die2(`'--${name}' 은 값을 받지 않는다`);
      v = true;
    } else if (eq >= 0) {
      v = a.slice(eq + 1);
    } else {
      v = argv[++i];
      if (v === undefined) die2(`'--${name}' 에 값이 없다`);
    }
    (opts[name] ??= []).push(v);
  }
  return { opts, rest };
}

/** 쓰는 사람이 잘못 쓴 경우 — 사용법 문제이므로 2 */
function die2(msg) { console.error(`✖ ${msg}`); process.exit(2); }

const { opts, rest } = parseArgs(process.argv.slice(2), ARITY);
const flag = (n) => opts[n] !== undefined;
const opt = (n) => (opts[n] ? opts[n][opts[n].length - 1] : null);   // 여러 번 주면 마지막 것

if (!rest.length) { console.error(USAGE); process.exit(2); }
if (rest.length > 1) die2(`입력 파일은 하나만 준다 (${rest.join(', ')})`);
const file = rest[0];

// ── --set 이름=값 : 빈 값·숫자 아님·'=' 없음을 전부 여기서 막는다.
//    Number('') 은 0 이라 그냥 통과시키면 B=0 짜리 쓰레기 도면이 조용히 만들어진다.
const overrides = Object.create(null);
for (const s of opts.set ?? []) {
  const eq = String(s).indexOf('=');
  if (eq < 0) die2(`--set 은 이름=값 꼴이어야 한다: '${s}'`);
  const k = String(s).slice(0, eq).trim();
  const raw = String(s).slice(eq + 1).trim();
  if (!k) die2(`--set 에 이름이 없다: '${s}'`);
  if (raw === '') die2(`--set ${k}= : 값이 비었다 (예: --set ${k}=92)`);
  const v = Number(raw);
  if (!Number.isFinite(v)) die2(`--set ${k}=${raw} : 숫자가 아니다`);
  overrides[k] = v;
}

/* loadDraft 가 파일을 읽고 검사하고, refs 를 따라 다른 조각까지 풀어 준다.
 * 소매처럼 몸판 암홀 길이를 받아야 하는 조각은 이 경로로만 열린다. */
let drawing, svg, dxf, deps = [];
try {
  const r = loadDraft(file, overrides);
  drawing = r.drawing; deps = r.deps;
  svg = toSVG(drawing, { points: !flag('no-points') });
  dxf = toDXF(drawing, { labels: flag('labels'), title: !flag('no-title') });
} catch (e) {
  if (e instanceof DraftError || e instanceof ExprError) {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const base = opt('out') ?? path.join('out', path.basename(file).replace(/\.draft\.json$|\.json$/, ''));
fs.mkdirSync(path.dirname(base), { recursive: true });
fs.writeFileSync(base + '.svg', svg);
fs.writeFileSync(base + '.dxf', dxf);
const cap = drawing.segments.find((s) => s.kind === 'sleevecap');
if (cap) {
  console.log(`  소매산 ${cap.derived.SC.toFixed(1)}cm · 곡선 ${cap.length.toFixed(2)} (AH ${cap.derived.AH.toFixed(2)} · 이세 ${cap.derived.ease.toFixed(2)})`);
  console.log(`  합인 너치 — 겨드랑에서 곡선 따라 앞 ${cap.derived.notchArcF.toFixed(2)}cm · 뒤 ${cap.derived.notchArcB.toFixed(2)}cm (몸판 암홀에 같은 호길이로 옮겨 찍는다)`);
}
if (deps.length) {
  console.log(`  참조: ${deps.map((d) => path.relative(process.cwd(), d)).join(' · ')}`);
}

const w = drawing.cutBbox.x1 - drawing.cutBbox.x0, h = drawing.cutBbox.y1 - drawing.cutBbox.y0;
console.log(`✔ ${drawing.name}`);
console.log(`  치수 ${Object.entries(drawing.measures).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  점 ${Object.keys(drawing.points).length} · 선 ${drawing.segments.length} · 다트 ${drawing.darts.length} · 너치 ${drawing.notches.length}`);
console.log(`  크기 ${w.toFixed(1)} × ${h.toFixed(1)} cm`);
for (const s of drawing.segments.filter((s) => s.layer === 'cut')) {
  console.log(`  ${s.id.padEnd(10)} ${s.length.toFixed(2)}cm  ${s.desc}`);
}
console.log(`  → ${base}.svg`);
console.log(`  → ${base}.dxf`);
