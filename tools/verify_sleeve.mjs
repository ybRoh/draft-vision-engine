#!/usr/bin/env node
/* 조각 간 참조 + 소매산 검증.
 *
 * 소매의 존재 이유는 하나다 — **소매산 곡선 길이 = 앞뒤 암홀 합 + 이세**.
 * 이게 안 맞으면 아무리 예쁘게 그려도 몸판에 안 붙는다. 그래서 그 항등식을
 * 사이즈·이세·산높이를 바꿔 가며 반복해서 잰다.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadDraft } from '../lib/project.mjs';
import { DraftError } from '../lib/draft.mjs';

let fail = 0;
const bad = (m) => { console.error('✖ ' + m); fail++; };
const near = (got, want, what, tol = 1e-6) => {
  if (!(Math.abs(got - want) <= tol)) bad(`${what}: 기대 ${want} · 실제 ${got}`);
};
/* URL.pathname 을 쓰면 안 된다 — 리포 경로에 한글이 있으면 퍼센트 인코딩된 문자열이 나와
 * fs 가 못 연다(예전에 few-shot 을 통째로 무력화했던 바로 그 함정). fileURLToPath 로 되돌린다. */
const 예제 = (n) => fileURLToPath(new URL(`../examples/${n}`, import.meta.url));
const 소매 = 예제('bunka-sleeve.draft.json');
const 앞판 = 예제('bunka-front.draft.json');
const 뒤판 = 예제('bunka-back.draft.json');

const 열기 = (ov = {}) => loadDraft(소매, ov);
const cap = (d) => d.segments.find((s) => s.id === 'cap');

// ── 참조가 실제로 몸판을 읽어 왔나
{
  const { drawing, deps } = 열기();
  if (deps.length !== 2) bad(`참조한 조각이 ${deps.length}개 (기대 2)`);
  const fah = loadDraft(앞판).drawing.segments.find((s) => s.id === 'armhole').length;
  const bah = loadDraft(뒤판).drawing.segments.find((s) => s.id === 'armhole').length;
  const c = cap(drawing);
  near(c.derived.AH, fah + bah, '소매가 받은 AH = 앞판+뒤판 암홀 실측', 1e-9);

  /* ★ 핵심 항등식. 이분탐색이 폭을 제대로 역산했는가.
   *   0.01cm 는 봉제에서 의미 없는 차이지만, 알고리즘이 깨지면 cm 단위로 벌어진다. */
  near(c.length, fah + bah, '소매산 곡선 길이 = 앞뒤 암홀 합 (이세 0)', 0.01);
  near(c.derived.ease, 0, '이세 0', 0.01);

  // 이세는 앞뒤 암홀 비율로 나뉜다 (이세 0 이면 각각 자기 암홀과 같아야 한다)
  near(c.derived.lenF, fah, '앞 소매산 = 앞 암홀', 0.01);
  near(c.derived.lenB, bah, '뒤 소매산 = 뒤 암홀', 0.01);

  // 정점이 실제로 꼭대기인가 (뒤집혀 그려지면 여기서 걸린다)
  const ys = c.pts.map((p) => p[1]);
  near(Math.min(...ys), drawing.points.APEX.y, '소매산 꼭대기 = APEX', 1e-9);
  // 겨드랑 코너 둘은 같은 높이(소매통선)
  near(drawing.points.CAP_F.y, drawing.points.CAP_B.y, '앞뒤 겨드랑 코너가 같은 높이', 1e-9);
  if (!(drawing.points.CAP_B.x < 0 && drawing.points.CAP_F.x > 0)) {
    bad('겨드랑 코너가 정점 좌우로 갈라지지 않았다');
  }

  /* 문화식 S자 — 겨드랑 쪽은 현 **아래**(오목), 중간은 현 **위**(볼록).
   * 전체가 현 위인 단순 돔이면 교재 곡선이 아니다.
   *
   * "어딘가 한 점이라도 현 아래로 내려간다" 로는 부족하다. 오목을 아예 빼도 곡선이
   * 코너 근처에서 살짝 넘실대며 그 검사를 통과해 버린다(실제로 통과했다).
   * 제도점 자체 — 합인 너치 — 가 현에서 **의미 있는 거리만큼** 오목한 쪽에 있는지 본다. */
  const AH = c.derived.AH;
  for (const [쪽, 코너id, 너치id, 최소, 제도거리] of [
    ['앞', 'CAP_F', 'CAP_NF', 0.03, AH / 8],          // ★ 문화식 제도점: 앞 AH/8
    ['뒤', 'CAP_B', 'CAP_NB', 0.015, AH / 12 + 0.6],  //                 뒤 AH/12+0.6
  ]) {
    const apex = [drawing.points.APEX.x, drawing.points.APEX.y];
    const corner = [drawing.points[코너id].x, drawing.points[코너id].y];
    const 너치 = [drawing.points[너치id].x, drawing.points[너치id].y];
    const ch = [corner[0] - apex[0], corner[1] - apex[1]];
    const L = Math.hypot(ch[0], ch[1]);
    // 현에서 너치까지의 부호 있는 거리. 현 바깥(코너를 감싸는 쪽)이 오목이다
    const 거리 = (ch[0] * (너치[1] - apex[1]) - ch[1] * (너치[0] - apex[0])) / L;
    const 안쪽 = Math.sign(ch[0]);      // 앞(+) / 뒤(−)
    const 오목깊이 = 거리 * 안쪽;      // hDn 과 같은 부호 쪽이 오목이다
    /* 합인 너치가 **제도점 자리**에 있는지 — 겨드랑에서 앞 AH/8 · 뒤 AH/12+0.6 만큼.
     * 몸판 암홀 너치와 여기서 만나야 소매가 제대로 물린다. 깊이만 재고 위치를 안 재면
     * 분할 위치를 바꿔도 검사가 통과한다. */
    {
      const f = 1 - Math.max(0, Math.min(제도거리 / L, 0.45));   // 코너에서 제도거리만큼 되돌아온 지점
      const 기대 = [apex[0] + ch[0] * f, apex[1] + ch[1] * f];
      const 현위투영 = ((너치[0] - apex[0]) * ch[0] + (너치[1] - apex[1]) * ch[1]) / (L * L);
      near(현위투영, f, `${쪽} 합인 너치가 제도점(겨드랑에서 ${제도거리.toFixed(2)}cm) 자리에 있다`, 1e-9);
    }
    if (!(오목깊이 > 최소 * L)) {
      bad(`${쪽} 소매산 합인이 현에서 충분히 오목하지 않다 (깊이 ${오목깊이.toFixed(3)}cm, 현 ${L.toFixed(1)}cm 의 ${(오목깊이 / L * 100).toFixed(1)}%)`);
    }
    /* 상부는 반대로 현 **위**로 볼록해야 한다.
     * 문턱을 "0보다 크다" 로 두면 안 된다 — 상부 볼록점(hUp)을 아예 빼도 곡선이 자연스럽게
     * 3.1~3.3% 부풀어 통과해 버린다(실제로 통과했다). 제도점이 살아 있으면 5.8~6.6% 다.
     * 그 사이인 4.5% 를 문턱으로 둔다. */
    const 앞쪽 = c.pts.filter((p) => Math.sign(p[0] - apex[0]) === 안쪽);
    const 볼록 = 앞쪽.map((p) => -(ch[0] * (p[1] - apex[1]) - ch[1] * (p[0] - apex[0])) / L * 안쪽);
    const 최대볼록 = Math.max(...볼록) / L;
    if (!(최대볼록 > 0.045)) {
      bad(`${쪽} 소매산 상부 볼록이 ${(최대볼록 * 100).toFixed(2)}% 뿐이다`
        + ` (제도점 AH/8 이 살아 있으면 5.8% 이상. 3% 대면 hUp 이 죽은 것)`);
    }
  }
}

// ── 이세를 넣으면 정확히 그만큼 길어진다
for (const e of [1, 2, 3.5]) {
  const d = 열기({ SLV_EASE: e }).drawing;
  const c = cap(d);
  near(c.length - c.derived.AH, e, `이세 ${e} 를 넣으면 곡선이 그만큼 길어진다`, 0.02);
}

// ── 산 높이를 낮추면 소매통이 넓어진다 (활동성 레버)
{
  const 낮게 = 열기({ CAP_H: 9 }).drawing, 높게 = 열기({ CAP_H: 14 }).drawing;
  const w = (d) => d.points.CAP_F.x - d.points.CAP_B.x;
  if (!(w(낮게) > w(높게))) bad(`산을 낮췄는데 소매통이 안 넓어졌다 (9cm→${w(낮게).toFixed(1)} · 14cm→${w(높게).toFixed(1)})`);
  // 산 높이를 바꿔도 곡선 길이는 암홀에 묶여 있어야 한다
  for (const [이름, d] of [['9cm', 낮게], ['14cm', 높게]]) {
    const c = cap(d);
    near(c.length, c.derived.AH, `산높이 ${이름} 에서도 곡선 길이 = 암홀`, 0.01);
  }
}

/* ── 그레이딩: B 를 바꾸면 몸판 암홀이 커지고 소매가 **따라온다**.
 *   이게 조각 간 참조를 만든 이유다. 참조가 끊기면 소매만 제자리에 남는다. */
{
  console.log('  호수    AH     소매산   소매통   이세');
  let 이전 = null;
  for (const [호, B] of [['44호', 78], ['55호', 82], ['66호', 86], ['77호', 92], ['88호', 98]]) {
    const d = 열기({ B }).drawing, c = cap(d);
    const 통 = d.points.CAP_F.x - d.points.CAP_B.x;
    console.log(`  ${호}  ${c.derived.AH.toFixed(2).padStart(6)}  ${c.length.toFixed(2).padStart(6)}`
      + `  ${통.toFixed(2).padStart(6)}  ${c.derived.ease.toFixed(3).padStart(6)}`);
    near(c.length, c.derived.AH, `${호} 소매산 = 암홀`, 0.01);
    if (이전) {
      if (!(c.derived.AH > 이전.ah)) bad(`${호}: B 를 키웠는데 암홀이 안 커졌다`);
      if (!(통 > 이전.통)) bad(`${호}: 암홀이 커졌는데 소매통이 안 커졌다 (참조가 끊겼나)`);
    }
    이전 = { ah: c.derived.AH, 통 };
  }
}

// ── 참조를 잘못 걸었을 때
const 임시 = fs.mkdtempSync(path.join(os.tmpdir(), 'dve-'));
const 던져야 = (fn, needle, what) => {
  try { fn(); bad(`${what}: 통과해버렸다`); }
  catch (e) {
    if (!(e instanceof DraftError)) { bad(`${what}: DraftError 가 아니다 — ${e.message}`); return; }
    if (needle && !e.message.includes(needle)) bad(`${what}: 메시지에 '${needle}' 이 없다 — ${e.message}`);
  }
};
{
  const 원본 = JSON.parse(fs.readFileSync(소매, 'utf8'));
  const 쓰기 = (name, obj) => {
    const p = path.join(임시, name);
    fs.writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  // 몸판 예제를 임시 폴더로 복사 (상대경로가 살아 있어야 한다)
  for (const f of [앞판, 뒤판]) fs.copyFileSync(f, path.join(임시, path.basename(f)));

  const 없는선 = JSON.parse(JSON.stringify(원본));
  없는선.refs[0].of = 'NOPE';
  던져야(() => loadDraft(쓰기('a.draft.json', 없는선)), "선 'NOPE'", '참조가 없는 선을 가리킴');

  const 없는파일 = JSON.parse(JSON.stringify(원본));
  없는파일.refs[0].draft = 'ghost.draft.json';
  던져야(() => loadDraft(쓰기('b.draft.json', 없는파일)), '읽지 못했다', '참조 파일이 없음');

  던져야(() => loadDraft(소매, { NOPE: 1 }), '어느 조각의', '없는 이름을 덮어씀');
  던져야(() => loadDraft(소매, { FAH: 20 }), '참조라 덮어쓸 수 없다', '참조값을 직접 덮어씀');

  /* 참조 고리 — a 가 b 를, b 가 a 를 가리킨다. 막지 않으면 스택오버플로로 죽는다. */
  const 고리A = JSON.parse(JSON.stringify(원본));
  고리A.refs = [{ id: 'X', desc: '고리', draft: 'cycB.draft.json', take: 'segmentLength', of: 'cap' }];
  const capA = 고리A.segments.find((s) => s.id === 'cap');
  capA.frontAH = 'X'; capA.backAH = 'X';   // FAH/BAH 를 지웠으니 식도 같이 갈아야 검사를 통과한다
  const 고리B = JSON.parse(JSON.stringify(고리A));
  고리B.refs[0].draft = 'cycA.draft.json';
  쓰기('cycB.draft.json', 고리B);
  /* 메시지가 **고리 경로를 다 찍는지**까지 본다. 그래야 readAll 의 1차 검출이 죽었을 때
   * (풀기 쪽 안전망만 남았을 때) 여기서 걸린다 — 안전망만 남으면 파일 이름이 하나만 나온다. */
  던져야(() => loadDraft(쓰기('cycA.draft.json', 고리A)), 'cycB.draft.json', '조각 참조 고리 (경로를 다 보여준다)');
  던져야(() => loadDraft(쓰기('cycA.draft.json', 고리A)), '고리를 이룬다', '조각 참조 고리');
}
fs.rmSync(임시, { recursive: true, force: true });

if (fail) { console.error(`✖ verify_sleeve: ${fail}건 실패`); process.exit(1); }
console.log('✔ verify_sleeve');
