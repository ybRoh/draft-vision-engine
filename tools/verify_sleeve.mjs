#!/usr/bin/env node
/* 조각 간 참조 + 소매산 검증 (교재 「반소매 원형」 제도법).
 *
 * 이 제도법의 정의는 **대각선(현)** 이다 — 앞 현 = 앞AH−(0~1), 뒤 현 = 뒤AH−(0~1),
 * 소매산 높이 = AH/4+2. 폭은 그 삼각형으로 정해지고, **이세는 결과로 나온다.**
 * (곡선 길이를 목표로 역산하는 다른 교재 방식과 혼동하지 말 것 — 그렇게 되돌리면
 *  현 길이가 도해 값과 어긋난다.)
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

  /* ★ 이 제도법의 정의 — 대각선(현)이 도해 값과 같은가.
   *   자로 재는 값이라 오차가 있으면 안 된다. */
  near(c.derived.chordF, fah - 1, '앞 대각선 = 앞AH − 1 (도해)', 1e-9);
  near(c.derived.chordB, bah - 1, '뒤 대각선 = 뒤AH − 1 (도해)', 1e-9);
  near(c.derived.SC, (fah + bah) / 4 + 2, '소매산 높이 = AH/4 + 2 (도해)', 1e-9);

  // 대각선·산높이·폭이 직각삼각형을 이룬다 (코너가 정말 그 대각선 끝인가)
  for (const [쪽, 코너id, 현] of [['앞', 'CAP_F', c.derived.chordF], ['뒤', 'CAP_B', c.derived.chordB]]) {
    const dx = drawing.points[코너id].x - drawing.points.APEX.x;
    const dy = drawing.points[코너id].y - drawing.points.APEX.y;
    near(Math.hypot(dx, dy), 현, `${쪽} 겨드랑 코너까지 실측 거리 = 대각선`, 1e-9);
    near(dy, c.derived.SC, `${쪽} 코너가 소매통선(y=소매산높이) 위에 있다`, 1e-9);
  }

  /* 이세는 **결과**다. 도해가 0~1 을 빼라고 한 것은 이세를 이 범위로 떨어뜨리기 위해서다.
   *   못 박지 않고 상식 범위만 본다 — 못 박으면 오목 깊이를 조금만 바꿔도 깨진다. */
  if (!(c.derived.ease > -0.5 && c.derived.ease < 3)) {
    bad(`이세가 상식 범위를 벗어났다: ${c.derived.ease.toFixed(2)}cm (기대 −0.5~3)`);
  }

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

/* ── 합인 너치의 **호길이** — 몸판 암홀에 옮겨 찍을 값
 *
 * 제도점은 현(대각선) 위에 놓는다. 하지만 봉제할 때 재는 것은 곡선을 따라간 길이다.
 * 둘은 다르다(앞 제도거리 AH/8 = 4.89 → 호길이 5.05). 몸판에 옮길 때 현 거리를 쓰면
 * 그만큼 어긋난다. */
{
  const d = 열기().drawing, c = cap(d);
  const 호 = (pts, target) => {
    let best = 0, bd = Infinity, acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const dist = Math.hypot(pts[i][0] - target[0], pts[i][1] - target[1]);
      if (dist < bd) { bd = dist; best = acc; }
    }
    return { arc: best, miss: bd };
  };
  const f = 호([...c.pts].reverse(), [d.points.CAP_NF.x, d.points.CAP_NF.y]);
  const b = 호(c.pts, [d.points.CAP_NB.x, d.points.CAP_NB.y]);
  if (f.miss > 0.02) bad(`앞 합인 너치가 소매산 곡선 위에 없다 (${f.miss.toFixed(3)}cm 벗어남)`);
  if (b.miss > 0.02) bad(`뒤 합인 너치가 소매산 곡선 위에 없다 (${b.miss.toFixed(3)}cm 벗어남)`);
  near(c.derived.notchArcF, f.arc, '앞 합인 호길이가 실측과 일치', 0.02);
  near(c.derived.notchArcB, b.arc, '뒤 합인 호길이가 실측과 일치', 0.02);
  /* 호길이는 제도거리(현)보다 길어야 한다. 같으면 현 거리를 그대로 내보낸 것이고,
   * 그 값을 몸판에 옮겨 찍으면 소매가 안 맞는다. */
  const AH = c.derived.AH;
  if (!(c.derived.notchArcF > AH / 8 + 0.01)) {
    bad(`앞 합인 호길이 ${c.derived.notchArcF.toFixed(2)} 가 제도거리 AH/8 ${(AH / 8).toFixed(2)} 보다 길지 않다`);
  }
  if (!(c.derived.notchArcB > AH / 12 + 0.6 + 0.005)) {
    bad(`뒤 합인 호길이 ${c.derived.notchArcB.toFixed(2)} 가 제도거리 ${(AH / 12 + 0.6).toFixed(2)} 보다 길지 않다`);
  }
}

/* ── 몸판 진동 합인 너치가 소매산 합인과 **같은 호길이**에 있는가
 *
 * 이게 안 맞으면 소매를 끼울 때 어긋난 채로 박게 된다. 몸판은 소매를 참조할 수 없어
 * (고리가 된다) 비율을 전사해 박았다 — 그 전사가 사이즈 전체에서 유효한지 여기서 잰다. */
{
  const 앞 = 예제('bunka-front.draft.json'), 뒤 = 예제('bunka-back.draft.json');
  for (const B of [78, 82, 86, 92, 98]) {
    const c = cap(loadDraft(소매, { B }).drawing);
    for (const [쪽, 파일, 소매호] of [['앞', 앞, c.derived.notchArcF], ['뒤', 뒤, c.derived.notchArcB]]) {
      const d = loadDraft(파일, { B }).drawing;
      const ah = d.segments.find((s) => s.id === 'armhole');
      const p = d.points.AH_N;
      if (!p) { bad(`${파일}: 진동 합인 너치 점(AH_N)이 없다`); continue; }
      // along 은 호길이 비율이므로 t × 전체길이 가 곧 겨드랑에서의 호길이다
      const 몸판호 = d.scope.AH_NOTCH_T * ah.length;
      const 차 = Math.abs(몸판호 - 소매호);
      if (차 > 0.1) {
        bad(`B=${B} ${쪽} 진동 합인이 소매산 합인과 ${차.toFixed(3)}cm 어긋난다`
          + ` (몸판 ${몸판호.toFixed(3)} · 소매 ${소매호.toFixed(3)})`);
      }
      /* 너치가 실제로 진동 곡선 위에 있는지.
       * **꼭짓점**까지의 거리로 재면 안 된다 — 폴리라인 꼭짓점은 0.3cm 간격이라
       * 사이에 놓인 점이 0.1cm 벗어난 것처럼 나온다(실제로 그렇게 잘못 쟀다).
       * 선분까지의 수직거리로 잰다. */
      let bd = Infinity;
      for (let i = 1; i < ah.pts.length; i++) {
        const [x1, y1] = ah.pts[i - 1], [x2, y2] = ah.pts[i];
        const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
        const t = L2 > 1e-18 ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / L2)) : 0;
        bd = Math.min(bd, Math.hypot(p.x - (x1 + dx * t), p.y - (y1 + dy * t)));
      }
      if (bd > 0.01) bad(`B=${B} ${쪽} 진동 합인 너치가 곡선 위에 없다 (${bd.toFixed(3)}cm 벗어남)`);
    }
  }
}

/* ── 도해의 "0~1 을 뺀다" 가 이세 조절 레버로 작동하는가.
 *   많이 뺄수록 현이 짧아지고 → 이세가 준다. 이 방향이 뒤집히면 제도법이 뒤집힌 것이다. */
{
  let 이전 = Infinity;
  for (const r of [0, 0.5, 1]) {
    const c = cap(열기({ F_RED: r, B_RED: r }).drawing);
    near(c.derived.chordF, 열기().drawing.segments.find((x) => x.id === 'cap').derived.chordF + (1 - r),
         `뺄값 ${r} 일 때 앞 대각선`, 1e-9);
    if (!(c.derived.ease < 이전)) bad(`뺄값을 ${r} 로 키웠는데 이세가 안 줄었다 (${c.derived.ease.toFixed(2)})`);
    이전 = c.derived.ease;
  }
}

// ── 산 높이를 낮추면 소매통이 넓어진다 (활동성 레버)
{
  const 낮게 = 열기({ CAP_H: 9 }).drawing, 높게 = 열기({ CAP_H: 14 }).drawing;
  const w = (d) => d.points.CAP_F.x - d.points.CAP_B.x;
  if (!(w(낮게) > w(높게))) bad(`산을 낮췄는데 소매통이 안 넓어졌다 (9cm→${w(낮게).toFixed(1)} · 14cm→${w(높게).toFixed(1)})`);
  // 산 높이를 바꿔도 대각선은 도해 값(앞AH−1)에 묶여 있어야 한다
  for (const [이름, d] of [['9cm', 낮게], ['14cm', 높게]]) {
    const c = cap(d);
    near(c.derived.chordF, c.derived.AH * 0 + 열기().drawing.segments.find((x) => x.id === 'cap').derived.chordF,
         `산높이 ${이름} 에서도 앞 대각선은 그대로`, 1e-9);
    near(c.derived.SC, 이름 === '9cm' ? 9 : 14, `산높이 ${이름} 이 그대로 쓰인다`, 1e-9);
  }
}

/* ── 그레이딩: B 를 바꾸면 몸판 암홀이 커지고 소매가 **따라온다**.
 *   이게 조각 간 참조를 만든 이유다. 참조가 끊기면 소매만 제자리에 남는다. */
{
  console.log('  호수    AH     산높이   소매통   곡선    이세');
  let 이전 = null;
  for (const [호, B] of [['44호', 78], ['55호', 82], ['66호', 86], ['77호', 92], ['88호', 98]]) {
    const d = 열기({ B }).drawing, c = cap(d);
    const 통 = d.points.CAP_F.x - d.points.CAP_B.x;
    console.log(`  ${호}  ${c.derived.AH.toFixed(2).padStart(6)}  ${c.derived.SC.toFixed(2).padStart(6)}`
      + `  ${통.toFixed(2).padStart(6)}  ${c.length.toFixed(2).padStart(6)}  ${c.derived.ease.toFixed(2).padStart(6)}`);
    near(c.derived.SC, c.derived.AH / 4 + 2, `${호} 소매산 높이 = AH/4+2`, 1e-9);
    if (!(c.derived.ease > -0.5 && c.derived.ease < 3)) bad(`${호} 이세가 상식 범위 밖: ${c.derived.ease.toFixed(2)}`);
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

  // 대각선이 소매산 높이보다 짧으면 삼각형이 안 된다 — 조용히 NaN 을 내보내면 안 된다
  던져야(() => loadDraft(소매, { CAP_H: 40 }), '보다 짧다', '산높이가 대각선보다 큼');

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
