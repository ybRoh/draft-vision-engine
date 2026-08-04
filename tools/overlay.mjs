#!/usr/bin/env node
/* 도면 ↔ 원본 사진 겹쳐보기 — 검증 루프의 '눈'.
 *
 *   node tools/overlay.mjs examples/bunka-front.draft.json scan/p128.jpg
 *   node tools/overlay.mjs out/p128.draft.json scan/p128.jpg --out out/p128.html --set B=92
 *
 * DSL 로 뽑은 도면을 교재 사진 위에 반투명으로 얹어, 어디가 어긋났는지 눈으로 찾는다.
 * 결과는 외부 의존이 하나도 없는 단일 HTML 이다 — 사진은 data URI, 도면은 인라인 SVG.
 * 그래야 파일 하나만 열면 되고, 나중에 다른 사람에게 그대로 넘길 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDraft } from '../lib/project.mjs';
import { toSVG } from '../lib/svg.mjs';

const 사용법 = [
  '사용법: node tools/overlay.mjs <draft.json> <원본이미지> [--out 경로.html] [--set 이름=값]...',
  '  --out  내보낼 HTML 경로. 기본값은 out/<입력파일이름>.overlay.html',
  '  --set  치수(measures)뿐 아니라 params(어깨경사·여유분 등)도 덮어쓴다',
].join('\n');

/* 플래그가 값을 받는지 적어 둔 표. render.mjs · extract.mjs 와 같은 규칙을 쓴다 —
 * 세 도구의 인자 처리가 서로 다르면 쓰는 사람이 매번 헷갈리고,
 * 모르는 플래그를 조용히 무시하면 오타가 그대로 통과한다. */
const ARITY = { out: 1, set: 1 };

/** 쓰는 사람이 잘못 쓴 경우 — 사용법 문제이므로 2 */
function die2(msg) { console.error(`✖ ${msg}`); process.exit(2); }

/** 인자를 플래그와 나머지(파일 이름)로 가른다. `--이름 값` 과 `--이름=값` 을 둘 다 받는다. */
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
const opt = (n) => (opts[n] ? opts[n][opts[n].length - 1] : null);   // 여러 번 주면 마지막 것

if (rest.length < 2) { console.error(사용법); process.exit(2); }
if (rest.length > 2) die2(`파일은 draft.json 과 이미지 둘만 준다 (${rest.join(', ')})`);
const [file, imgFile] = rest;

// --set 이름=값 : 빈 값·숫자 아님·'=' 없음을 전부 막는다. Number('') 은 0 이라 그냥 두면 조용히 통과한다
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

// ── 원본 이미지 읽기 (브라우저가 <img src> 로 바로 먹을 수 있는 형식만)
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const ext = path.extname(imgFile).toLowerCase();
if (!MIME[ext]) {
  console.error(`✖ 지원하지 않는 이미지 형식 '${ext || '(확장자 없음)'}' — ${imgFile}`);
  console.error('  png · jpg · jpeg · webp · gif 만 된다. PDF·TIFF 라면 먼저 png 로 바꿔서 넣어라.');
  process.exit(2);
}
let imgBuf;
try { imgBuf = fs.readFileSync(imgFile); }
catch (e) {
  console.error(`✖ 원본 이미지를 읽지 못했다: ${imgFile}`);
  console.error('  ' + e.message);
  process.exit(2);
}
if (!imgBuf.length) { console.error(`✖ 원본 이미지가 빈 파일이다: ${imgFile}`); process.exit(2); }

// ── DSL → 도형 → SVG

let drawing;
try { drawing = loadDraft(file, overrides).drawing; }
catch (e) {
  console.error(`✖ 도면을 못 풀었다 — ${file}`);
  console.error('  ' + e.message);
  process.exit(1);
}
const svgStr = toSVG(drawing, { points: true, grid: true });

// ── HTML 에 값을 심을 때 쓰는 이스케이프
//    문자열은 HTML 텍스트/속성용, JSON 은 </script> 로 탈출하지 못하게 꺾쇠까지 유니코드로 바꾼다.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const j = (v) => JSON.stringify(v)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const vb = svgStr.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const META = {
  draft: path.basename(file),
  image: path.basename(imgFile),
  name: drawing.name,
  origin: [vb[0], vb[1]],          // SVG 로컬 (0,0) 이 가리키는 도면 cm 좌표
  viewCm: [vb[2], vb[3]],
  bbox: drawing.bbox,
  measures: Object.entries(drawing.measures).map(([k, v]) => [k, v]),
  overrides: Object.entries(overrides).map(([k, v]) => [k, v]),
  cuts: drawing.segments.filter((s) => s.layer === 'cut').map((s) => [s.id, Number(s.length.toFixed(2)), s.desc]),
};

const dataUri = `data:${MIME[ext]};base64,${imgBuf.toString('base64')}`;

// ── 단일 HTML
//    브라우저 쪽 스크립트는 문자열 연결만 쓴다(템플릿 리터럴 금지) — 이 파일이 이미 템플릿 리터럴이라 헷갈린다.
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>겹쳐보기 — ${esc(drawing.name)}</title>
<style>
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: #fff; color: #111;
  font: 13px/1.55 system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }

#viewport { position: fixed; inset: 0 336px 0 0; overflow: auto; background: #eef0f3; }
#sizer { position: relative; }
#stage { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
#photo { position: absolute; top: 0; left: 0; display: block; user-select: none; -webkit-user-drag: none; }
#wrap { position: absolute; top: 0; left: 0; transform-origin: 0 0; will-change: transform; }
#wrap svg { display: block; }
#marks { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
#viewport.measuring { cursor: crosshair; }
#viewport.dragging { cursor: grabbing; }

#panel { position: fixed; top: 0; right: 0; width: 336px; height: 100%; overflow-y: auto;
  background: #fff; border-left: 1px solid #d4d7dd; padding: 12px 14px 48px; }
#panel h1 { font-size: 14px; margin: 0 0 2px; }
#panel .sub { color: #6b7280; font-size: 11px; margin: 0 0 10px; word-break: break-all; }
section { border-top: 1px solid #e5e7eb; padding: 9px 0 4px; }
section > h2 { font-size: 12px; margin: 0 0 6px; color: #374151; letter-spacing: -0.2px; }
.row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
.row label { width: 62px; flex: none; color: #4b5563; font-size: 12px; }
.row input[type=range] { flex: 1; min-width: 0; }
.row input[type=number] { width: 74px; flex: none; padding: 2px 4px; font: inherit;
  border: 1px solid #cbd5e1; border-radius: 4px; }
.val { width: 58px; flex: none; text-align: right; font-variant-numeric: tabular-nums; color: #111; font-size: 12px; }
button { font: inherit; padding: 4px 9px; border: 1px solid #cbd5e1; border-radius: 5px;
  background: #f8fafc; cursor: pointer; }
button:hover { background: #eef2f7; }
button.on { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
button.wide { width: 100%; margin-top: 5px; }
.layers { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 8px; }
.layers label { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #374151; cursor: pointer; }
.sw { width: 15px; height: 3px; flex: none; border-radius: 2px; }
.note { color: #6b7280; font-size: 11px; margin: 5px 0 0; }
.warn { color: #b91c1c; }
#tf { width: 100%; height: 116px; font: 11px/1.4 ui-monospace, Menlo, monospace;
  border: 1px solid #cbd5e1; border-radius: 5px; padding: 5px; resize: vertical; background: #f8fafc; }
table.len { width: 100%; border-collapse: collapse; font-size: 11px; }
table.len td { padding: 1px 0; border-bottom: 1px solid #f1f3f5; }
table.len td.n { text-align: right; font-variant-numeric: tabular-nums; color: #111; }
table.len td.d { color: #6b7280; }
#tip { position: fixed; z-index: 20; display: none; pointer-events: none; max-width: 260px;
  background: rgba(17,17,17,.92); color: #fff; padding: 3px 7px; border-radius: 4px; font-size: 12px; }
kbd { border: 1px solid #cbd5e1; border-bottom-width: 2px; border-radius: 3px; padding: 0 3px;
  background: #f8fafc; font: 11px ui-monospace, Menlo, monospace; }
</style>
</head>
<body>

<div id="viewport"><div id="sizer"><div id="stage">
  <img id="photo" src="${dataUri}" alt="원본 도면 사진">
  <div id="wrap">
${svgStr}
  </div>
  <svg id="marks" xmlns="http://www.w3.org/2000/svg"></svg>
</div></div></div>

<aside id="panel">
  <h1>겹쳐보기 — ${esc(drawing.name)}</h1>
  <p class="sub">도면 ${esc(META.draft)} · 사진 ${esc(META.image)}<br>
     크기 ${(drawing.bbox.x1 - drawing.bbox.x0).toFixed(1)} × ${(drawing.bbox.y1 - drawing.bbox.y0).toFixed(1)} cm</p>

  <section>
    <h2>보기</h2>
    <div class="row"><label>도면 진하기</label><input type="range" id="op" min="0" max="100" value="70"><span class="val" id="opV">70%</span></div>
    <div class="row"><label>사진 진하기</label><input type="range" id="pop" min="0" max="100" value="100"><span class="val" id="popV">100%</span></div>
    <div class="row"><label>화면 배율</label><input type="range" id="view" min="10" max="400" value="100"><span class="val" id="viewV">100%</span></div>
  </section>

  <section>
    <h2>도면 맞추기</h2>
    <div class="row"><label>배율</label><input type="range" id="sc" min="1" max="4000" value="100"><input type="number" id="scN" step="0.01" min="0.01"></div>
    <div class="row"><label>가로 이동</label><input type="range" id="dx" min="-2000" max="2000" value="0"><span class="val" id="dxV">0</span></div>
    <div class="row"><label>세로 이동</label><input type="range" id="dy" min="-2000" max="2000" value="0"><span class="val" id="dyV">0</span></div>
    <div class="row"><label>회전°</label><input type="range" id="rot" min="-10" max="10" step="0.05" value="0"><input type="number" id="rotN" step="0.05" min="-10" max="10"></div>
    <p class="note">도면 위를 <b>끌면</b> 이동, <b>휠</b>은 도면 배율(마우스 위치 기준),
      <kbd>Alt</kbd>+휠은 화면 배율. <kbd>←↑→↓</kbd> 1px, <kbd>Shift</kbd>+화살표 10px.</p>
    <button class="wide" id="reset">초기화</button>
  </section>

  <section>
    <h2>2점 배율 맞추기</h2>
    <p class="note">사진에서 <b>실제 길이를 아는 두 점</b>(예: 자 눈금 10cm, 방안지 칸)을 찍고 그 길이를 넣으면
      배율이 계산돼 적용된다. 5cm 자와 눈으로 맞추는 것보다 정확하다.</p>
    <button class="wide" id="measure">① 두 점 찍기 시작</button>
    <div class="row"><label>실제 길이</label><input type="number" id="realCm" step="0.1" min="0.1" value="10"><span class="val">cm</span></div>
    <button class="wide" id="applyCal" disabled>② 이 배율로 맞추기</button>
    <p class="note" id="calOut">아직 찍은 점이 없다.</p>
  </section>

  <section>
    <h2>레이어</h2>
    <div class="layers" id="layers"></div>
  </section>

  <section>
    <h2>변환값</h2>
    <textarea id="tf" readonly spellcheck="false"></textarea>
    <button class="wide" id="copy">변환값 복사 (JSON)</button>
    <p class="note" id="copyOut">자동 정합에 쓸 값이다. 맞춘 뒤 복사해 두면 다시 손으로 맞출 일이 없다.</p>
  </section>

  <section>
    <h2>완성선 길이 (참고)</h2>
    <table class="len" id="lenT"></table>
    <p class="note" id="measOut"></p>
  </section>
</aside>

<div id="tip"></div>

<script>
(function () {
'use strict';
var META = ${j(META)};
var PXCM = 10;                       // 배율 1 일 때 1cm = 10px. 배율 × 10 이 곧 px/cm 이다.
var NS = 'http://www.w3.org/2000/svg';

var vp = document.getElementById('viewport');
var sizer = document.getElementById('sizer');
var stage = document.getElementById('stage');
var photo = document.getElementById('photo');
var wrap = document.getElementById('wrap');
var marks = document.getElementById('marks');
var tip = document.getElementById('tip');
var svg = wrap.querySelector('svg');
var $ = function (id) { return document.getElementById(id); };

// ── 도면 SVG 의 viewBox 는 cm 다. 화면 픽셀 크기를 PXCM 로 못박아 배율 계산을 단순하게 만든다.
var vb = svg.getAttribute('viewBox').trim().split(/\\s+/).map(Number);
var svgW = vb[2] * PXCM, svgH = vb[3] * PXCM;
svg.setAttribute('width', svgW);
svg.setAttribute('height', svgH);
svg.removeAttribute('style');

// ── 레이어 보충
// toSVG 는 선(segment)에만 data-layer 를 달아 준다. 다트·너치·점·모눈·자·흰 배경은 여기서 이름을 붙인다.
// (흰 배경을 그대로 두면 사진을 덮어 버리므로 반드시 따로 끌 수 있어야 한다.)
function 레이어정리() {
  var i, els;
  var segG = svg.querySelector('g[fill="none"]');
  var bg = svg.querySelector('rect');
  if (bg) bg.setAttribute('data-layer', 'bg');
  var grid = svg.querySelector('path[stroke="#e5e7eb"]');
  if (grid) grid.setAttribute('data-layer', 'grid');
  var ptg = svg.querySelector('g[font-size]');
  if (ptg) ptg.setAttribute('data-layer', 'points');
  els = svg.querySelectorAll('path[data-id]:not([data-layer])');   // 선 그룹 안에서 layer 가 없는 건 다트
  for (i = 0; i < els.length; i++) els[i].setAttribute('data-layer', 'dart');
  els = svg.querySelectorAll(':scope > circle');                   // 최상위 원은 너치
  for (i = 0; i < els.length; i++) if (!els[i].hasAttribute('data-layer')) els[i].setAttribute('data-layer', 'notch');
  els = svg.children;                                              // 남은 최상위 요소 = 5cm 자
  for (i = 0; i < els.length; i++) {
    if (els[i] === segG || els[i].tagName === 'title' || els[i].hasAttribute('data-layer')) continue;
    els[i].setAttribute('data-layer', 'ruler');
  }
}
레이어정리();

// ── 히트 영역
// 선이 0.09cm 라 확대 전에는 마우스로 짚기가 거의 불가능하다.
// 같은 경로를 투명하고 굵게 복사해 깔고, 툴팁·강조는 그 복사본이 받는다.
var hitG = document.createElementNS(NS, 'g');
(function () {
  hitG.setAttribute('fill', 'none');
  hitG.setAttribute('stroke', 'rgba(0,0,0,0)');
  hitG.setAttribute('stroke-width', '0.55');
  hitG.setAttribute('stroke-linecap', 'round');
  var src = svg.querySelectorAll('path[data-id]');
  for (var i = 0; i < src.length; i++) {
    var p = src[i];
    var c = document.createElementNS(NS, 'path');
    c.setAttribute('d', p.getAttribute('d'));
    c.setAttribute('data-layer', p.getAttribute('data-layer') || 'cut');
    var t = p.querySelector('title');
    c.setAttribute('data-tip', (t ? t.textContent : (p.getAttribute('data-id') || '')));
    c.__src = p;
    hitG.appendChild(c);
  }
  svg.appendChild(hitG);
})();

var 강조중 = null;
hitG.addEventListener('mouseover', function (e) {
  var el = e.target;
  if (!el.getAttribute || !el.hasAttribute('data-tip')) return;
  tip.textContent = el.getAttribute('data-tip');
  tip.style.display = 'block';
  if (강조중) 강조중.setAttribute('stroke-width', 강조중.__w);
  var s = el.__src;
  if (s) { s.__w = s.getAttribute('stroke-width'); s.setAttribute('stroke-width', s.__w * 2.6); 강조중 = s; }
});
hitG.addEventListener('mouseout', function () {
  tip.style.display = 'none';
  if (강조중) { 강조중.setAttribute('stroke-width', 강조중.__w); 강조중 = null; }
});
document.addEventListener('mousemove', function (e) {
  if (tip.style.display !== 'block') return;
  tip.style.left = (e.clientX + 14) + 'px';
  tip.style.top = (e.clientY + 16) + 'px';
});

// ── 레이어 켜기/끄기
var 레이어목록 = [
  ['cut', '완성선', '#111', true], ['guide', '안내선', '#888', true],
  ['fold', '골선', '#2563eb', true], ['dart', '다트', '#dc2626', true],
  ['construction', '보조선', '#16a34a', true], ['notch', '너치', '#16a34a', true],
  ['points', '점·이름', '#b91c1c', true], ['grid', '1cm 모눈', '#e5e7eb', false],
  ['ruler', '5cm 자', '#111', true], ['bg', '도면 흰 배경', '#d1d5db', false]
];
function 레이어표시(key, on) {
  var els = svg.querySelectorAll('[data-layer="' + key + '"]');
  for (var i = 0; i < els.length; i++) els[i].style.display = on ? '' : 'none';
}
(function () {
  var box = $('layers');
  레이어목록.forEach(function (L) {
    var lab = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = L[3];
    cb.addEventListener('change', function () { 레이어표시(L[0], cb.checked); });
    var sw = document.createElement('span');
    sw.className = 'sw'; sw.style.background = L[2];
    lab.appendChild(cb); lab.appendChild(sw);
    lab.appendChild(document.createTextNode(L[1]));
    box.appendChild(lab);
    레이어표시(L[0], L[3]);
  });
})();

// ── 변환 상태
// 화면 픽셀 = [dx,dy] + 회전(rot) × (scale × SVG로컬픽셀).  transform-origin 은 0 0 이라 순수 아핀이다.
var T = { scale: 1, dx: 0, dy: 0, rot: 0 };
var 기본T = { scale: 1, dx: 0, dy: 0, rot: 0 };
var view = 1, 기본view = 1;
var natW = 1, natH = 1;

function 적용() {
  wrap.style.transform = 'translate(' + T.dx.toFixed(2) + 'px,' + T.dy.toFixed(2) + 'px) rotate('
    + T.rot.toFixed(3) + 'deg) scale(' + T.scale.toFixed(5) + ')';
  동기화();
}
function 동기화() {
  $('sc').value = Math.round(T.scale * 100);
  $('scN').value = Number(T.scale.toFixed(3));
  $('dx').value = Math.round(T.dx); $('dxV').textContent = Math.round(T.dx);
  $('dy').value = Math.round(T.dy); $('dyV').textContent = Math.round(T.dy);
  $('rot').value = T.rot; $('rotN').value = Number(T.rot.toFixed(2));
  $('tf').value = 변환JSON();
  계산표시();
}
// 배율·회전을 바꿀 때 화면의 한 점(anchor, 무대 좌표)이 제자리에 남도록 dx/dy 를 함께 옮긴다.
// 그러지 않으면 슬라이더를 조금만 움직여도 도면이 화면 밖으로 달아난다.
function 배율설정(s2, anchor) {
  s2 = Math.min(400, Math.max(0.01, s2));
  var k = s2 / T.scale;
  if (anchor) { T.dx = anchor.x - k * (anchor.x - T.dx); T.dy = anchor.y - k * (anchor.y - T.dy); }
  T.scale = s2; 적용();
}
function 회전설정(r2, anchor) {
  r2 = Math.min(10, Math.max(-10, r2));
  var d = (r2 - T.rot) * Math.PI / 180;
  if (anchor) {
    var vx = T.dx - anchor.x, vy = T.dy - anchor.y;
    T.dx = anchor.x + vx * Math.cos(d) - vy * Math.sin(d);
    T.dy = anchor.y + vx * Math.sin(d) + vy * Math.cos(d);
  }
  T.rot = r2; 적용();
}
function 화면중심() {
  return { x: (vp.scrollLeft + vp.clientWidth / 2) / view, y: (vp.scrollTop + vp.clientHeight / 2) / view };
}
function 무대좌표(e) {
  var r = stage.getBoundingClientRect();
  return { x: (e.clientX - r.left) / view, y: (e.clientY - r.top) / view };
}
function 화면배율(v2, anchor, 화면점) {
  v2 = Math.min(4, Math.max(0.1, v2));
  if (!anchor) { anchor = 화면중심(); 화면점 = { x: vp.clientWidth / 2, y: vp.clientHeight / 2 }; }
  view = v2;
  sizer.style.width = (natW * view) + 'px';
  sizer.style.height = (natH * view) + 'px';
  stage.style.transform = 'scale(' + view + ')';
  vp.scrollLeft = anchor.x * view - 화면점.x;
  vp.scrollTop = anchor.y * view - 화면점.y;
  $('view').value = Math.round(view * 100);
  $('viewV').textContent = Math.round(view * 100) + '%';
  마크그리기();
}

function 변환JSON() {
  return JSON.stringify({
    draft: META.draft, image: META.image,
    scale: Number(T.scale.toFixed(5)),
    dx: Number(T.dx.toFixed(2)), dy: Number(T.dy.toFixed(2)),
    rotDeg: Number(T.rot.toFixed(3)),
    pxPerCm: Number((T.scale * PXCM).toFixed(4)),
    originCm: META.origin,
    note: '사진픽셀 = [dx,dy] + 회전(rotDeg, 시계방향+) × pxPerCm × (도면cm − originCm)'
  }, null, 2);
}
function 계산표시() {
  var cm = parseFloat($('realCm').value);
  var d = 측정.pts.length === 2 ? 거리(측정.pts[0], 측정.pts[1]) : null;
  var s = '배율 ' + T.scale.toFixed(3) + ' → ' + (T.scale * PXCM).toFixed(2) + ' px/cm';
  if (d) {
    s += ' · 찍은 두 점 ' + d.toFixed(1) + ' px = 지금 배율로 ' + (d / (T.scale * PXCM)).toFixed(2) + ' cm';
    if (cm > 0) s += ' (입력 ' + cm + ' cm)';
  }
  $('calOut').textContent = s;
}

// ── 2점 배율 맞추기
var 측정 = { on: false, pts: [] };
function 거리(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function 마크그리기() {
  var r = 7 / view, w = 1.6 / view, s = '';
  if (측정.pts.length === 2) {
    s += '<line x1="' + 측정.pts[0].x + '" y1="' + 측정.pts[0].y + '" x2="' + 측정.pts[1].x + '" y2="' + 측정.pts[1].y
      + '" stroke="#e11d48" stroke-width="' + w + '" stroke-dasharray="' + (5 / view) + ' ' + (4 / view) + '"/>';
  }
  측정.pts.forEach(function (p) {
    s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + r + '" fill="none" stroke="#e11d48" stroke-width="' + w + '"/>'
      + '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (1.4 / view) + '" fill="#e11d48"/>';
  });
  marks.innerHTML = s;
}
$('measure').addEventListener('click', function () {
  측정.on = !측정.on;
  측정.pts = [];
  마크그리기();
  this.classList.toggle('on', 측정.on);
  this.textContent = 측정.on ? '① 점 찍는 중 — 사진 위를 두 번 클릭 (다시 누르면 취소)' : '① 두 점 찍기 시작';
  vp.classList.toggle('measuring', 측정.on);
  $('applyCal').disabled = true;
  $('calOut').textContent = 측정.on ? '사진에서 실제 길이를 아는 두 점을 클릭해라.' : '아직 찍은 점이 없다.';
});
vp.addEventListener('click', function (e) {
  if (!측정.on || 끌기.moved) return;
  if (측정.pts.length >= 2) 측정.pts = [];
  측정.pts.push(무대좌표(e));
  마크그리기();
  $('applyCal').disabled = 측정.pts.length !== 2;
  계산표시();
});
$('realCm').addEventListener('input', 계산표시);
$('applyCal').addEventListener('click', function () {
  var cm = parseFloat($('realCm').value);
  if (!(cm > 0)) { $('calOut').innerHTML = '<span class="warn">실제 길이를 cm 로 넣어라.</span>'; return; }
  if (측정.pts.length !== 2) return;
  var d = 거리(측정.pts[0], 측정.pts[1]);
  // 첫 번째로 찍은 점을 고정해 두고 배율만 바꾼다 → 맞춰 둔 위치가 크게 흐트러지지 않는다
  배율설정(d / (cm * PXCM), 측정.pts[0]);
});

// ── 마우스: 도면 끌어 옮기기 · 휠 확대
var 끌기 = { on: false, moved: false, x: 0, y: 0, dx: 0, dy: 0 };
vp.addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  var p = 무대좌표(e);
  끌기 = { on: true, moved: false, x: p.x, y: p.y, dx: T.dx, dy: T.dy };
  if (!측정.on) { vp.classList.add('dragging'); e.preventDefault(); }
});
window.addEventListener('mousemove', function (e) {
  if (!끌기.on) return;
  var p = 무대좌표(e);
  if (Math.abs(p.x - 끌기.x) + Math.abs(p.y - 끌기.y) > 2) 끌기.moved = true;
  if (측정.on) return;                       // 측정 중에는 도면을 건드리지 않는다
  T.dx = 끌기.dx + (p.x - 끌기.x);
  T.dy = 끌기.dy + (p.y - 끌기.y);
  적용();
});
window.addEventListener('mouseup', function () {
  끌기.on = false;
  vp.classList.remove('dragging');
  setTimeout(function () { 끌기.moved = false; }, 0);   // click 이 뒤따라 오므로 그 다음에 푼다
});
vp.addEventListener('wheel', function (e) {
  e.preventDefault();
  var k = Math.pow(1.0015, -e.deltaY);
  if (e.altKey) {
    var r = stage.getBoundingClientRect(), vr = vp.getBoundingClientRect();
    화면배율(view * k, 무대좌표(e), { x: e.clientX - vr.left, y: e.clientY - vr.top });
  } else {
    배율설정(T.scale * k, 무대좌표(e));
  }
}, { passive: false });

// ── 조작 패널
$('op').addEventListener('input', function () { wrap.style.opacity = this.value / 100; $('opV').textContent = this.value + '%'; });
$('pop').addEventListener('input', function () { photo.style.opacity = this.value / 100; $('popV').textContent = this.value + '%'; });
$('view').addEventListener('input', function () { 화면배율(this.value / 100); });
$('sc').addEventListener('input', function () { 배율설정(this.value / 100, 화면중심()); });
$('scN').addEventListener('input', function () { var v = parseFloat(this.value); if (v > 0) 배율설정(v, 화면중심()); });
$('dx').addEventListener('input', function () { T.dx = Number(this.value); 적용(); });
$('dy').addEventListener('input', function () { T.dy = Number(this.value); 적용(); });
$('rot').addEventListener('input', function () { 회전설정(Number(this.value), 화면중심()); });
$('rotN').addEventListener('input', function () { var v = parseFloat(this.value); if (isFinite(v)) 회전설정(v, 화면중심()); });
$('reset').addEventListener('click', function () {
  T = { scale: 기본T.scale, dx: 기본T.dx, dy: 기본T.dy, rot: 0 };
  적용();
  화면배율(기본view);
});
window.addEventListener('keydown', function (e) {
  var t = e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA') return;
  var step = e.shiftKey ? 10 : 1, moved = true;
  if (e.key === 'ArrowLeft') T.dx -= step;
  else if (e.key === 'ArrowRight') T.dx += step;
  else if (e.key === 'ArrowUp') T.dy -= step;
  else if (e.key === 'ArrowDown') T.dy += step;
  else moved = false;
  if (moved) { e.preventDefault(); 적용(); }
});
$('copy').addEventListener('click', function () {
  var box = $('tf'), out = $('copyOut');
  var ok = function () { out.textContent = '복사했다. 자동 정합 스크립트에 그대로 넣으면 된다.'; };
  var no = function () { out.innerHTML = '<span class="warn">복사가 막혔다 — 위 상자에서 직접 골라 복사해라.</span>'; };
  box.removeAttribute('readonly'); box.select(); box.setSelectionRange(0, box.value.length);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(ok, function () { document.execCommand('copy') ? ok() : no(); });
    else if (document.execCommand('copy')) ok(); else no();
  } catch (err) { no(); }
  box.setAttribute('readonly', 'readonly');
});

// ── 참고 표
(function () {
  var t = $('lenT'), rows = '';
  META.cuts.forEach(function (c) {
    rows += '<tr><td>' + c[0] + '</td><td class="n">' + c[1].toFixed(2) + 'cm</td><td class="d">' + c[2] + '</td></tr>';
  });
  t.innerHTML = rows || '<tr><td class="d">완성선(cut) 이 없다</td></tr>';
  var m = META.measures.map(function (x) { return x[0] + '=' + x[1]; }).join(' ');
  $('measOut').textContent = '치수 ' + m + (META.overrides.length ? ' (--set 적용됨)' : '');
})();

// ── 사진 크기를 알아야 무대 크기와 첫 배율을 잡을 수 있다
function 시작() {
  natW = photo.naturalWidth || photo.width || 1000;
  natH = photo.naturalHeight || photo.height || 1000;
  stage.style.width = natW + 'px';
  stage.style.height = natH + 'px';
  marks.setAttribute('width', natW);
  marks.setAttribute('height', natH);
  var lim = Math.round(Math.max(natW, natH) + svgW);
  $('dx').min = -lim; $('dx').max = lim;
  $('dy').min = -lim; $('dy').max = lim;

  // 첫 배율: 도면 폭이 사진 폭의 80% 가 되게. 어차피 2점 배율로 다시 잡겠지만 시작점은 있어야 한다.
  var s = Math.max(0.02, (natW * 0.8) / svgW);
  기본T = { scale: s, dx: (natW - svgW * s) / 2, dy: (natH - svgH * s) / 2, rot: 0 };
  T = { scale: 기본T.scale, dx: 기본T.dx, dy: 기본T.dy, rot: 0 };
  wrap.style.opacity = 0.7;

  /* 사진이 다 보이게 첫 화면 배율을 잡는다.
   * clientWidth/Height 가 아직 0 이면(레이아웃 전) 음수가 나와 슬라이더 최소값(10%)에 눌린다 —
   * 그래서 아래 시작 시점을 레이아웃 뒤로 미루고, 여기서도 한 번 더 바닥을 깐다. */
  var 여유 = 24;
  var fw = vp.clientWidth > 여유 ? (vp.clientWidth - 여유) / natW : 1;
  var fh = vp.clientHeight > 여유 ? (vp.clientHeight - 여유) / natH : 1;
  기본view = Math.max(0.1, Math.min(1, fw, fh));
  적용();
  화면배율(기본view);
}
/* data URI 사진은 complete 가 곧바로 참이라 여기서 바로 부르면 **CSS 레이아웃 전에** 돈다.
 * 그러면 vp.clientWidth/Height 가 0 이라 첫 배율이 엉뚱하게 잡힌다.
 * requestAnimationFrame 으로 한 프레임 미뤄 레이아웃이 끝난 뒤에 잰다. */
function 레이아웃뒤(f) { requestAnimationFrame(function () { requestAnimationFrame(f); }); }
if (photo.complete && photo.naturalWidth) 레이아웃뒤(시작);
else photo.addEventListener('load', function () { 레이아웃뒤(시작); });
// 창 크기가 바뀌어도 사람이 맞춰 둔 도면 변환(T)은 건드리지 않는다 — 화면 배율만 다시 잡는다
addEventListener('resize', function () {
  if (!natW) return;
  var fw = (vp.clientWidth - 24) / natW, fh = (vp.clientHeight - 24) / natH;
  기본view = Math.max(0.1, Math.min(1, fw, fh));
});
})();
</script>
</body>
</html>
`;

const out = opt('out') ?? path.join('out', path.basename(file).replace(/\.draft\.json$|\.json$/, '') + '.overlay.html');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);

const w = drawing.bbox.x1 - drawing.bbox.x0, h = drawing.bbox.y1 - drawing.bbox.y0;
const kb = (n) => (n / 1024 < 1024 ? (n / 1024).toFixed(0) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB');
console.log(`✔ ${drawing.name} — 겹쳐보기 파일을 만들었다`);
console.log(`  도면 ${w.toFixed(1)} × ${h.toFixed(1)} cm · 선 ${drawing.segments.length} · 점 ${Object.keys(drawing.points).length}`);
if (Object.keys(overrides).length) console.log(`  치수 덮어쓰기 ${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  사진 ${imgFile} (${kb(imgBuf.length)})`);
console.log(`  → ${out} (${kb(Buffer.byteLength(html))})`);
console.log('');
console.log('  다음 순서로 본다:');
console.log(`   1. open ${out}`);
console.log('   2. 사진에서 실제 길이를 아는 두 점을 찍고 cm 를 넣어 "이 배율로 맞추기" — 눈대중보다 정확하다');
console.log('   3. 도면을 끌어 원점(앞중심·어깨선 교차)을 사진에 포갠 뒤, 스캔이 기울었으면 회전으로 잡는다');
console.log('   4. 어긋난 선을 찾으면 그 선 위에 마우스를 올려 이름·길이를 확인하고 draft.json 을 고친다');
console.log('   5. 다 맞으면 "변환값 복사" 로 scale/dx/dy/rot 을 챙겨 둔다 (나중에 자동 정합 기준값)');
