#!/usr/bin/env node
/* 그레이딩 검증 — 이 엔진의 존재 이유.
 *
 * 좌표만 뽑아낸 벡터화 결과였다면 치수를 바꿔도 아무것도 안 따라온다.
 * 계산식으로 뽑았다면 B 를 키웠을 때 도면이 통째로 자라야 한다.
 * 여기서 무너지면 "식이 아니라 숫자를 박아 넣었다" 는 뜻이다.
 */
import fs from 'node:fs';
import { resolve } from '../lib/draft.mjs';

let fail = 0;
const bad = (m) => { console.error('✖ ' + m); fail++; };

const SIZES = [
  { name: '44호', B: 78, WL: 36.5, SW: 36.5 },
  { name: '55호', B: 82, WL: 37.5, SW: 37.5 },
  { name: '66호', B: 86, WL: 38.0, SW: 39.0 },
  { name: '77호', B: 92, WL: 39.0, SW: 40.5 },
  { name: '88호', B: 98, WL: 40.0, SW: 42.0 },
];

for (const file of ['bunka-front', 'bunka-back']) {
  const spec = JSON.parse(fs.readFileSync(new URL(`../examples/${file}.draft.json`, import.meta.url)));
  const known = new Set(spec.measures.map((m) => m.id));
  const rows = [];

  for (const sz of SIZES) {
    const ov = {};
    for (const k of ['B', 'WL', 'SW']) if (known.has(k)) ov[k] = sz[k];
    let d;
    try { d = resolve(spec, ov); }
    catch (e) { bad(`${file} ${sz.name}: ${e.message}`); continue; }

    const cut = d.segments.filter((s) => s.layer === 'cut');
    for (const s of cut) {
      if (!isFinite(s.length) || s.length <= 0) bad(`${file} ${sz.name} ${s.id}: 길이가 ${s.length}`);
    }
    for (const [id, p] of Object.entries(d.points)) {
      if (!isFinite(p.x) || !isFinite(p.y)) bad(`${file} ${sz.name} ${id}: 좌표 NaN`);
    }
    rows.push({
      sz: sz.name,
      width: d.cutBbox.x1 - d.cutBbox.x0,
      height: d.cutBbox.y1 - d.cutBbox.y0,
      ah: cut.find((s) => s.id === 'armhole').length,
      sh: cut.find((s) => s.id === 'shoulder').length,
      neck: cut.find((s) => s.id === 'neck').length,
    });
  }

  // 호수가 커지면 모든 주요 치수가 **단조 증가** 해야 한다
  for (const key of ['width', 'height', 'ah', 'sh', 'neck']) {
    for (let i = 1; i < rows.length; i++) {
      if (!(rows[i][key] > rows[i - 1][key])) {
        bad(`${file}: ${rows[i - 1].sz}→${rows[i].sz} 에서 ${key} 가 안 커진다 (${rows[i - 1][key].toFixed(2)} → ${rows[i][key].toFixed(2)})`);
      }
    }
  }
  // 44호→88호에서 폭이 B 증가분(20cm)의 1/4 (=5cm) 만큼 늘어야 한다 — 반폭 도면이므로
  const grew = rows[rows.length - 1].width - rows[0].width;
  if (Math.abs(grew - 5) > 0.6) bad(`${file}: 44→88 폭 증가 ${grew.toFixed(2)}cm (B/4 기준 5cm 이어야)`);

  console.log(`  ${file}`);
  console.log('    호수    폭      높이    암홀    어깨    목선');
  for (const r of rows) {
    console.log(`    ${r.sz}  ${r.width.toFixed(2).padStart(6)}  ${r.height.toFixed(2).padStart(6)}`
      + `  ${r.ah.toFixed(2).padStart(6)}  ${r.sh.toFixed(2).padStart(6)}  ${r.neck.toFixed(2).padStart(6)}`);
  }
}

/* 앞·뒤 암홀 합 = 총 진동둘레. 원형 단계에서 40cm 안팎이면 정상 범위.
 * (붙는 조각끼리 길이를 맞추는 본격 검증은 pattern-sewability-verify 스킬 쪽 일이다) */
const f = JSON.parse(fs.readFileSync(new URL('../examples/bunka-front.draft.json', import.meta.url)));
const b = JSON.parse(fs.readFileSync(new URL('../examples/bunka-back.draft.json', import.meta.url)));
for (const sz of SIZES) {
  const ah = ['front', 'back'].map((_, i) => {
    const spec = i === 0 ? f : b;
    const known = new Set(spec.measures.map((m) => m.id));
    const ov = {}; for (const k of ['B', 'WL', 'SW']) if (known.has(k)) ov[k] = sz[k];
    return resolve(spec, ov).segments.find((s) => s.id === 'armhole').length;
  });
  const total = ah[0] + ah[1];
  if (total < 32 || total > 50) bad(`${sz.name}: 앞+뒤 암홀 ${total.toFixed(1)}cm — 원형 범위(32~50) 밖`);
}

console.log(fail ? `✖ verify_grade: ${fail}건 실패` : '✔ verify_grade');
process.exit(fail ? 1 : 0);
