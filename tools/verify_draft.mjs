#!/usr/bin/env node
/* DSL 해석 검증 — 좌표를 손으로 계산한 값과 대조하고, 잘못된 DSL 을 제대로 걷어내는지 본다. */
import fs from 'node:fs';
import { validate } from '../lib/validate.mjs';
import { resolve, DraftError } from '../lib/draft.mjs';
import { fsArmhole } from '../lib/curve.mjs';

let fail = 0;
const bad = (m) => { console.error('✖ ' + m); fail++; };
const near = (got, want, what, tol = 1e-6) => {
  if (!(Math.abs(got - want) <= tol)) bad(`${what}: 기대 ${want} · 실제 ${got}`);
};

const front = JSON.parse(fs.readFileSync(new URL('../examples/bunka-front.draft.json', import.meta.url)));
const back = JSON.parse(fs.readFileSync(new URL('../examples/bunka-back.draft.json', import.meta.url)));

// ── 예제는 스키마를 통과해야 한다
for (const [name, spec] of [['front', front], ['back', back]]) {
  const errs = validate(spec);
  if (errs.length) bad(`${name} 예제가 스키마를 통과 못한다:\n    ${errs.join('\n    ')}`);
}

// ── 좌표 손계산 대조 (B=86, WL=38, SW=39)
const d = resolve(front);
const P = d.points;
near(P.SNP.x, 86 / 20 + 2.9, 'SNP.x = B/20+2.9');
near(P.SNP.y, 0, 'SNP.y');
near(P.SIDE_T.x, 86 / 4 + 1, 'SIDE_T.x = B/4+1');
near(P.CF_W.y, 38, 'CF_W.y = WL');
near(P.SIDE_B.y, 86 / 6 + 7, 'SIDE_B.y = B/6+7');
near(P.FNP.y, 86 / 20 + 2.9 + 1, 'FNP.y = 목너비+1');
// 어깨끝 = 어깨경사선 × 어깨너비선
near(P.SP.x, 39 / 2, 'SP.x = SW/2');
near(P.SP.y, (39 / 2 - (86 / 20 + 2.9)) * Math.tan(22 * Math.PI / 180), 'SP.y = 가로거리·tan22', 1e-9);
// on: 앞품선 위 65%
near(P.AH_M.x, 86 / 6 + 3, 'AH_M.x = B/6+3');
near(P.AH_M.y, -1 + 0.65 * (86 / 6 + 7 + 1), 'AH_M.y = 앞품선 위 65%');
// 다른 점 좌표를 식에서 참조
near(P.D_C.x, P.BP.x, 'D_C.x 가 BP.x 를 따라간다');
near(P.D_C.y, 38, 'D_C.y = WL');
near(d.darts[0].width, 2.5, '다트 벌림 = DART_W');

// ── 곡선은 양 끝점을 정확히 지나야 한다
const ah = d.segments.find((s) => s.id === 'armhole');
near(ah.pts[0][0], P.SP.x, '암홀 시작 = SP.x', 1e-9);
near(ah.pts[ah.pts.length - 1][1], P.SIDE_B.y, '암홀 끝 = SIDE_B.y', 1e-9);
/* 길이·중간점을 소수 이하까지 못 박는다.
 * "15 < 길이 < 25" 같은 밴드만 두면 tension 을 0.42→0.9 로 바꾸거나 곡선을 직선으로
 * 만들어도 통과한다 — 곡선 기하가 사실상 미검증 상태가 된다. */
near(ah.length, 19.4714, '앞 암홀 길이', 0.002);
near(d.segments.find((s) => s.id === 'neck').length, 11.9247, '앞 목선 길이', 0.002);
{
  const mid = ah.pts[Math.floor(ah.pts.length / 2)];
  near(mid[0], 17.7052, '암홀 중간점 x', 0.002);
  near(mid[1], 17.2680, '암홀 중간점 y', 0.002);
}
// ── closed:true 는 실제로 첫 점으로 돌아와야 한다
{
  const box = d.segments.find((s) => s.id === 'box');
  if (box.pts.length !== 5) bad(`closed 사각형 정점이 ${box.pts.length}개 (기대 5)`);
  near(box.pts[0][0], box.pts[box.pts.length - 1][0], 'closed 사각형 x 가 닫힘', 1e-12);
  near(box.pts[0][1], box.pts[box.pts.length - 1][1], 'closed 사각형 y 가 닫힘', 1e-12);
}

/* ── 제도법 곡선(목선·암홀)의 규칙
 *
 * 길이 숫자만 못 박으면 "그 값이 나오게" 아무 곡선이나 맞춰 넣어도 통과한다.
 * 아래는 교재 제도법 자체의 성질이라, 핸들 계산을 잘못 건드리면 반드시 깨진다. */
{
  const 단위 = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  const 어깨 = 단위([d.points.SP.x - d.points.SNP.x, d.points.SP.y - d.points.SNP.y]);

  // (1) 목선은 옆목점에 **어깨선과 직각**으로 도착해야 한다. 아니면 목선-어깨 이음매에 각이 진다
  {
    const nk = d.segments.find((s) => s.id === 'neck');
    const g = nk.segs[nk.segs.length - 1];
    const t = 단위([g.p1[0] - g.c2[0], g.p1[1] - g.c2[1]]);
    near(t[0] * 어깨[0] + t[1] * 어깨[1], 0, '목선이 SNP 에서 어깨선과 직각', 1e-9);
  }

  // (2) 암홀도 어깨끝에서 **어깨선과 직각**으로 출발해야 한다
  {
    const g = ah.segs[0];
    const t = 단위([g.c1[0] - g.p0[0], g.c1[1] - g.p0[1]]);
    near(t[0] * 어깨[0] + t[1] * 어깨[1], 0, '암홀이 SP 에서 어깨선과 직각', 1e-9);
  }

  // (3) 암홀은 품점의 x 를 지나고, 높이는 어깨~겨드랑의 **중간**이다 (제도법이 정하는 값)
  near(ah.derived.pitch[0], d.points.AH_M.x, '암홀 품점 x = AH_M.x', 1e-12);
  near(ah.derived.pitch[1], (d.points.SP.y + d.points.SIDE_B.y) / 2, '암홀 품점 y = 어깨~겨드랑 중간', 1e-12);

  /* (4) 겨드랑 쪽은 **오목**해야 한다 — 이게 진동이 파이는 이유다.
   *     오목점이 현(품점→겨드랑) 바깥으로 나가면 단순 볼록 돔이 되어 팔이 안 올라간다. */
  {
    const [px, py] = ah.derived.pitch, [hx, hy] = ah.derived.hollow;
    const ux = d.points.SIDE_B.x, uy = d.points.SIDE_B.y;
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;
    const s1 = cross(ux - px, uy - py, hx - px, hy - py);        // 오목점이 현의 어느 쪽인가
    const s2 = cross(ux - px, uy - py, 0, uy - py);              // 코너(품선×겨드랑선)는 어느 쪽인가
    if (!(s1 * s2 > 0)) bad('암홀 겨드랑 쪽이 오목하지 않다 (오목점이 현 바깥으로 나갔다)');
    if (!(Math.abs(s1) < Math.abs(s2))) bad('암홀 오목점이 코너보다 더 파였다');
  }

  /* (5) 좌우 대칭 — 앞판은 겨드랑이 품점 왼쪽에 오므로 내부에서 x 를 뒤집어 센다.
   *     그 뒤집기가 틀리면 한쪽 암홀만 조용히 다른 모양이 된다. 거울상이 정확히 같은지 본다. */
  {
    const SH = [10, 0], NK = [2, 1], U = [18, 20], pX = 15;
    const a = fsArmhole(SH, NK, pX, U);
    const mx = (p) => [100 - p[0], p[1]];
    const b = fsArmhole(mx(SH), mx(NK), 100 - pX, mx(U));
    a.segs.forEach((g, i) => {
      for (const k of ['p0', 'c1', 'c2', 'p1']) {
        near(b.segs[i][k][0], 100 - g[k][0], `암홀 좌우반전 ${i}.${k}.x`, 1e-9);
        near(b.segs[i][k][1], g[k][1], `암홀 좌우반전 ${i}.${k}.y`, 1e-9);
      }
    });
  }
}

/* ── 민소매 진동 (armhole_sleeveless)
 *
 * 셋인 진동과 **모양이 달라야** 한다는 게 이 kind 를 따로 만든 이유다.
 * 셋인은 어깨 쪽이 현 위로 볼록한 S자인데, 민소매가 그러면 좁은 어깨끈에서 진동이
 * 바깥으로 부풀어 못 쓴다. 그래서 "전 구간 오목" 을 실제로 잰다. */
{
  const 민 = resolve(JSON.parse(fs.readFileSync(new URL('../examples/scan025-front.draft.json', import.meta.url))));
  const ah = 민.segments.find((s) => s.id === 'armhole');
  if (ah.kind !== 'armhole_sleeveless') bad(`scan025 앞판 진동 kind 가 ${ah.kind} 다 (기대 armhole_sleeveless)`);
  const SP = [민.points.SP.x, 민.points.SP.y];
  const UA = [민.points.UA.x, 민.points.UA.y];
  const SNP = [민.points.SNP.x, 민.points.SNP.y];
  const 단위 = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };

  // (1) 어깨끝에서 어깨선과 직각으로 출발 — 목선·어깨와 이어지는 곳에 각이 지지 않게
  {
    const g = ah.segs[0];
    const t = 단위([g.c1[0] - g.p0[0], g.c1[1] - g.p0[1]]);
    const sh = 단위([SP[0] - SNP[0], SP[1] - SNP[1]]);
    near(t[0] * sh[0] + t[1] * sh[1], 0, '민소매 진동이 SP 에서 어깨선과 직각', 1e-9);
  }

  // (2) 겨드랑에는 수평으로 도착 — 앞뒤판을 박았을 때 진동이 한 줄로 이어져야 한다
  {
    const g = ah.segs[ah.segs.length - 1];
    const t = 단위([g.p1[0] - g.c2[0], g.p1[1] - g.c2[1]]);
    near(t[1], 0, '민소매 진동이 겨드랑에 수평으로 도착', 1e-9);
  }

  /* (3) ★ 전 구간이 현보다 **안쪽**에 있어야 한다. 한 점이라도 바깥으로 나가면
   *     셋인 진동처럼 부푼 것이다 — 이 kind 를 만든 이유가 사라진다. */
  {
    const ch = [UA[0] - SP[0], UA[1] - SP[1]], L = Math.hypot(ch[0], ch[1]);
    const 안쪽부호 = Math.sign((ch[0] * (SNP[1] - SP[1]) - ch[1] * (SNP[0] - SP[0])));
    let 최대 = 0, 바깥 = 0;
    for (const p of ah.pts) {
      const d = (ch[0] * (p[1] - SP[1]) - ch[1] * (p[0] - SP[0])) / L * 안쪽부호;
      if (d < -1e-9) 바깥++;
      if (d > 최대) 최대 = d;
    }
    if (바깥) bad(`민소매 진동이 현 바깥으로 나간 점이 ${바깥}개 (전 구간 오목이어야 한다)`);

    /* (4) 제도점에서의 깊이가 도해값(AH_IN)과 정확히 같아야 한다.
     *     "최대 깊이" 로 재면 안 된다 — 곡선은 제도점을 지나되 그 사이에서 조금 더 부푼다.
     *     제도점 깊이는 정확히, 최대 깊이는 그보다 지나치지 않게(1.3배 이내) 본다. */
    const sp2 = ah.derived.scoopPt;
    // 제도점은 품 **높이** 에 있고, 현에서 **가로로** 도해값만큼 들어가 있어야 한다
    near(sp2[1], 민.points.AH_P.y, '민소매 진동 제도점이 품 높이에 있다', 1e-9);
    const 현x = SP[0] + ch[0] * ((sp2[1] - SP[1]) / ch[1]);
    near(현x - sp2[0], 민.scope.AH_IN, '민소매 진동 제도점이 현에서 가로로 도해값만큼 들어감', 1e-9);
    if (!(최대 <= 민.scope.AH_IN * 1.4)) bad(`민소매 진동이 도해값(${민.scope.AH_IN})보다 과하게 파였다: ${최대.toFixed(2)}`);
  }
}

// ── 뒤어깨 늘림: hypot() 식이 실제로 SH_EASE 만큼 길게 만들었나
const db = resolve(back);
const shBack = db.segments.find((s) => s.id === 'shoulder').length;
const sp0 = Math.hypot(db.points.SP0.x - db.points.SNP.x, db.points.SP0.y - db.points.SNP.y);
near(shBack, sp0 + 0.7, '뒤어깨 = SP0까지 거리 + SH_EASE', 1e-9);

// ── 치수 덮어쓰기
const big = resolve(front, { B: 98 });
near(big.points.SIDE_T.x, 98 / 4 + 1, 'B=98 덮어쓰기가 반폭에 반영된다');
if (big.measures.B !== 98) bad('measures 에 덮어쓴 값이 안 들어갔다');
try { resolve(front, { NOPE: 1 }); bad('없는 치수를 덮어썼는데 통과했다'); }
catch (e) { if (!(e instanceof DraftError)) bad('없는 치수 덮어쓰기: DraftError 가 아니다'); }

// ── 잘못된 DSL 걷어내기
const clone = () => JSON.parse(JSON.stringify(front));
const mustFail = (mutate, needle, what) => {
  const s = clone(); mutate(s);
  const errs = validate(s);
  if (!errs.length) { bad(`${what}: 통과해버렸다`); return; }
  if (needle && !errs.some((e) => e.includes(needle))) bad(`${what}: 오류 메시지에 '${needle}' 이 없다\n    ${errs.join('\n    ')}`);
};
mustFail((s) => { s.segments[0].pts[0] = 'GHOST'; }, "점 'GHOST'", '없는 점 참조');
mustFail((s) => { s.points.push({ ...s.points[0], id: 'SNP' }); }, '겹친다', 'id 중복');
mustFail((s) => { s.segments[0].layer = 'wat'; }, 'layer', '없는 레이어');
mustFail((s) => { delete s.points[0].x; }, '빠졌다', '필수 항목 누락');
mustFail((s) => { s.points[0].id = '1st'; }, '식에서 못 쓴다', '식에서 못 쓰는 id');
mustFail((s) => { s.segments[1].pts = ['A']; }, '2개 이상', '점 1개짜리 선');
mustFail((s) => { s.darts[0].apex = 'GHOST'; }, "점 'GHOST'", '다트가 없는 점을 가리킴');
mustFail((s) => { s.segments.push(JSON.parse(JSON.stringify(s.segments[0]))); }, '겹친다', 'segment id 중복');
mustFail((s) => { s.notches.push(JSON.parse(JSON.stringify(s.notches[0]))); }, '겹친다', 'notch id 중복');
mustFail((s) => { s.points = []; s.segments = []; }, '점이 하나도 없다', '빈 도면');
/* 목선·암홀이 전용 kind 로 바뀌어 픽스처에 자유곡선이 없다.
 * 픽스처에서 찾지 말고 검사할 곡선을 직접 만들어 넣는다 — 그래야 예제 구성이 바뀌어도 안 죽는다. */
const 자유곡선 = (t) => ({ id: 'tmp_curve', desc: '검사용', kind: 'curve', layer: 'cut',
                            through: ['CF_W', 'SIDE_W'], tension: t });
mustFail((s) => { s.segments.push(자유곡선(1e9)); }, '범위 밖', 'tension 폭주');
mustFail((s) => { s.segments.push(자유곡선(-5)); }, '범위 밖', '음수 tension');
mustFail((s) => { s.segments[1].pts = ['CF_B', 'CF_B']; }, '연달아 두 번', '같은 점을 두 번 이은 선');

/* 계산식 검사 — 모델이 가장 자주 틀리는 자리다.
 * 검사기가 식을 안 보면 extract 의 "고쳐 달라" 재시도가 아예 안 돌고,
 * API 를 한 번 다 쓴 뒤 resolve 단계에서 스택트레이스로 죽는다. */
mustFail((s) => { s.points[1].dx = 'B/4+1)'; }, '식이 잘못됐다', '괄호가 안 맞는 식');
mustFail((s) => { s.points[1].dx = 'ZZZ*2'; }, "모르는 이름 'ZZZ'", '없는 이름을 쓰는 식');
mustFail((s) => { s.points[1].dx = ''; }, '식이 잘못됐다', '빈 식');
mustFail((s) => { s.points[1].dx = 'process.exit(1)'; }, '식이 잘못됐다', '코드처럼 생긴 식');
mustFail((s) => { s.points[6].y = 'round(B/4, 1)'; }, '식이 잘못됐다', '인자 수가 틀린 함수');

// 프로토타입 키가 additionalProperties 검사를 그냥 통과하면 안 된다
mustFail((s) => { s.points[0].toString = 'x'; }, '모르는 항목', "'toString' 이라는 항목");
mustFail((s) => { s.measures[0].constructor = 1; }, '모르는 항목', "'constructor' 라는 항목");

// 치수 이름이 프로토타입 멤버와 같아도 선언값이 살아야 한다
{
  const s = clone();
  s.measures.push({ id: 'toString', desc: '함정', value: 33 });
  s.points.push({ id: 'TS', desc: '함정 점', kind: 'xy', x: 'toString', y: 0 });
  if (validate(s).length) bad("id 'toString' 이 스키마에서 먼저 걸렸다 (의도와 다름)");
  const r = resolve(s);
  near(r.points.TS.x, 33, "치수 이름이 'toString' 이어도 선언값이 이긴다");
}

// ── 참조 고리는 잡아내야 한다 (스키마는 통과하지만 풀 수 없는 DSL)
{
  const s = clone();
  s.points.push({ id: 'X1', desc: '고리1', kind: 'offset', from: 'X2', dx: 1, dy: 0 });
  s.points.push({ id: 'X2', desc: '고리2', kind: 'offset', from: 'X1', dx: 1, dy: 0 });
  if (validate(s).length) bad('고리 DSL 이 스키마에서 먼저 걸렸다 (의도와 다름)');
  try { resolve(s); bad('참조 고리를 못 잡았다'); }
  catch (e) { if (!/고리/.test(e.message)) bad(`고리 오류 메시지가 이상하다: ${e.message}`); }
}
// ── 평행선 교점
{
  const s = clone();
  s.points.push({ id: 'PARA', desc: '평행', kind: 'intersect', a1: 'A', a2: 'SIDE_T', b1: 'CF_W', b2: 'SIDE_W' });
  try { resolve(s); bad('평행선 교점을 못 잡았다'); }
  catch (e) { if (!/평행/.test(e.message)) bad(`평행 오류 메시지가 이상하다: ${e.message}`); }
}

console.log(fail ? `✖ verify_draft: ${fail}건 실패` : '✔ verify_draft');
process.exit(fail ? 1 : 0);
