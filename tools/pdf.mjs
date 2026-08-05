#!/usr/bin/env node
/* DSL → PDF (1:1 실물 크기, A4 분할).
 *
 *   node tools/pdf.mjs examples/overblouse-mudart-front.draft.json
 *   node tools/pdf.mjs examples/bunka-front.draft.json --set B=98 --out out/88호.pdf
 *   node tools/pdf.mjs examples/bunka-sleeve.draft.json --paper a3 --landscape
 *
 * 뽑은 PDF 는 프린터에서 **100%(실제 크기)** 로 인쇄해야 한다. "페이지에 맞춤" 을 켜면
 * 축소되어 패턴이 못 쓰게 된다. 첫 장의 5cm 사각형을 자로 재서 확인한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DraftError } from '../lib/draft.mjs';
import { loadDraft } from '../lib/project.mjs';
import { ExprError } from '../lib/expr.mjs';
import { toPDF, hasNonAscii } from '../lib/pdf.mjs';

const 사용법 = [
  '사용법: node tools/pdf.mjs <draft.json> [--out 경로.pdf] [--set 이름=값]...',
  '        [--paper a4|a3|letter] [--landscape] [--margin cm] [--no-points]',
  '  --set      치수·상수 덮어쓰기 (호수 변경). 참조하는 조각까지 함께 따라온다',
  '  --paper    용지 (기본 a4)',
  '  --margin   인쇄 여백 cm (기본 1.0) — 프린터가 못 찍는 가장자리',
  '  --no-points 점·이름을 빼고 선만 (재단용으로 깔끔하다)',
].join('\n');

/* render.mjs · extract.mjs 와 같은 인자 규칙 */
const ARITY = { out: 1, set: 1, paper: 1, margin: 1, landscape: 0, 'no-points': 0 };

function die2(msg) { console.error(`✖ ${msg}`); process.exit(2); }

function parseArgs(argv, arity) {
  const opts = Object.create(null);
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

const { opts, rest } = parseArgs(process.argv.slice(2), ARITY);
const opt = (n) => (opts[n] ? opts[n][opts[n].length - 1] : null);
const flag = (n) => Boolean(opts[n]);

if (!rest.length) { console.error(사용법); process.exit(2); }
if (rest.length > 1) die2(`파일은 하나만 준다 (${rest.join(', ')})`);
const file = rest[0];

// --set 이름=값 : Number('') 은 0 이라 빈 값을 그냥 두면 조용히 통과한다
const overrides = Object.create(null);
for (const s of opts.set ?? []) {
  const eq = String(s).indexOf('=');
  if (eq < 0) die2(`--set 은 이름=값 꼴이어야 한다: '${s}'`);
  const k = String(s).slice(0, eq).trim(), raw = String(s).slice(eq + 1).trim();
  if (!k) die2(`--set 에 이름이 없다: '${s}'`);
  if (raw === '') die2(`--set ${k}= : 값이 비었다 (예: --set ${k}=92)`);
  const v = Number(raw);
  if (!Number.isFinite(v)) die2(`--set ${k}=${raw} : 숫자가 아니다`);
  overrides[k] = v;
}

const margin = opt('margin') === null ? 1.0 : Number(opt('margin'));
if (!Number.isFinite(margin) || margin < 0) die2(`--margin 이 숫자가 아니다: '${opt('margin')}'`);

let drawing, res, deps = [];
try {
  const r = loadDraft(file, overrides);
  drawing = r.drawing; deps = r.deps;
  res = toPDF(drawing, {
    paper: opt('paper') ?? 'a4',
    landscape: flag('landscape'),
    margin,
    points: !flag('no-points'),
  });
} catch (e) {
  if (e instanceof DraftError || e instanceof ExprError) { console.error(`✖ ${e.message}`); process.exit(1); }
  throw e;
}

/* 저장 이름은 기본으로 **원본 파일 이름**을 따른다 — 어느 도면에서 나온 PDF 인지
 * 파일 이름만 보고 알 수 있어야 한다. --out 으로 바꿀 수 있다. */
const out = opt('out') ?? path.join('out', path.basename(file).replace(/\.draft\.json$|\.json$/, '') + '.pdf');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, res.buf);

console.log(`✔ ${drawing.name}`);
if (deps.length) console.log(`  참조: ${deps.map((d) => path.relative(process.cwd(), d)).join(' · ')}`);
if (Object.keys(overrides).length) {
  console.log(`  덮어쓰기: ${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}
console.log(`  조각 크기 ${res.size.w.toFixed(1)} × ${res.size.h.toFixed(1)} cm`);
console.log(`  ${res.cols}×${res.rows} = ${res.cols * res.rows}장 + 확인용 1장 = 전체 ${res.pages}장`);
console.log(`  → ${out}  (${(res.buf.length / 1024).toFixed(0)} KB)`);
if (hasNonAscii(drawing.name)) {
  console.log('  ※ 도면 이름에 한글이 있어 PDF 안 글자에서는 빠집니다 — 기본 폰트에 한글 글리프가 없습니다.');
  console.log('    (선·치수는 그대로 나옵니다. 파일 이름에는 한글이 남습니다.)');
}
console.log('');
console.log('  인쇄할 때: 프린터 설정을 **실제 크기(100%)** 로 하십시오.');
console.log('  "페이지에 맞춤" 을 켜면 축소되어 패턴을 못 씁니다.');
console.log('  첫 장의 5cm 사각형을 자로 재서 확인한 뒤 나머지를 뽑으십시오.');
