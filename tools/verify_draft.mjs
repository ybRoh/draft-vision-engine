#!/usr/bin/env node
/* DSL 해석 검증 — 좌표를 손으로 계산한 값과 대조하고, 잘못된 DSL 을 제대로 걷어내는지 본다. */
import fs from 'node:fs';
import { validate } from '../lib/validate.mjs';
import { resolve, DraftError } from '../lib/draft.mjs';

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
near(ah.length, 18.4829, '앞 암홀 길이', 0.002);
near(d.segments.find((s) => s.id === 'neck').length, 11.0665, '앞 목선 길이', 0.002);
{
  const mid = ah.pts[Math.floor(ah.pts.length / 2)];
  near(mid[0], 17.3333, '암홀 중간점 x', 0.002);
  near(mid[1], 13.5167, '암홀 중간점 y', 0.002);
}
// ── closed:true 는 실제로 첫 점으로 돌아와야 한다
{
  const box = d.segments.find((s) => s.id === 'box');
  if (box.pts.length !== 5) bad(`closed 사각형 정점이 ${box.pts.length}개 (기대 5)`);
  near(box.pts[0][0], box.pts[box.pts.length - 1][0], 'closed 사각형 x 가 닫힘', 1e-12);
  near(box.pts[0][1], box.pts[box.pts.length - 1][1], 'closed 사각형 y 가 닫힘', 1e-12);
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
mustFail((s) => { s.segments.find((x) => x.kind === 'curve').tension = 1e9; }, '범위 밖', 'tension 폭주');
mustFail((s) => { s.segments.find((x) => x.kind === 'curve').tension = -5; }, '범위 밖', '음수 tension');
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
