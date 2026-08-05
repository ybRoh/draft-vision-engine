#!/usr/bin/env node
/* DSL 해석 검증 — 좌표를 손으로 계산한 값과 대조하고, 잘못된 DSL 을 제대로 걷어내는지 본다. */
import fs from 'node:fs';
import { validate } from '../lib/validate.mjs';
import { resolve, DraftError } from '../lib/draft.mjs';
import { fsArmhole } from '../lib/curve.mjs';
import { loadDraft } from '../lib/project.mjs';
import { fileURLToPath } from 'node:url';

/* 오버블라우스는 compare(원형비교패턴)를 쓰므로 resolve() 로는 못 연다 — 다른 조각의 도형이
 * 필요하기 때문이다. 파일을 따라가는 loadDraft 로 연다. URL.pathname 은 한글 경로에서
 * 퍼센트 인코딩되므로 fileURLToPath 를 쓴다. */
const 예제경로 = (n) => fileURLToPath(new URL(`../examples/${n}`, import.meta.url));
const 스캔앞판 = () => loadDraft(예제경로('overblouse-mudart-front.draft.json')).drawing;
const 열기 = (n) => loadDraft(예제경로(n)).drawing;

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

/* ── 원형에서 물려받은 진동 (traced)
 *
 * 응용의 진동은 원형 진동을 그대로 가져와 **양 끝만** 옮겨 그린다. 새로 그리면 원형과
 * 다른 곡선이 되어 "원형 참조" 가 말뿐이 된다. 그래서 여기서 **원형 곡선과 같은 모양인지**
 * 를 독립적으로 다시 계산해 대조한다. */
{
  const 민 = 스캔앞판();
  const ah = 민.segments.find((s) => s.id === 'armhole');
  if (ah.kind !== 'traced') bad(`오버블라우스 앞판 진동 kind 가 ${ah.kind} 다 (기대 traced)`);

  // 끝점이 정확히 SP · UA 에 붙어야 한다 (한쪽만 붙으면 조각이 안 닫힌다)
  near(ah.pts[0][0], 민.points.SP.x, '진동 시작 = SP.x', 1e-9);
  near(ah.pts[0][1], 민.points.SP.y, '진동 시작 = SP.y', 1e-9);
  near(ah.pts[ah.pts.length - 1][0], 민.points.UA.x, '진동 끝 = UA.x', 1e-9);
  near(ah.pts[ah.pts.length - 1][1], 민.points.UA.y, '진동 끝 = UA.y', 1e-9);

  /* 원형에서 물려받되 **끝은 바로잡는다(true up)**.
   *
   * 닮음변환은 모양을 그대로 살리지만 끝 접선까지 같이 돌린다. 원형이 어깨선·옆선과
   * 직각이었어도 20도 돌면 그만큼 각이 진다 — 실제로 진동-옆선 112도, 진동-어깨 71도가
   * 나왔다. 그래서 옮긴 뒤 접선만 고쳐 다시 그린다. 아래 셋을 다 봐야 의미가 있다:
   * 끝점이 붙었는가 · 끝이 직각인가 · 원형의 성격이 남았는가. */
  const 단위2 = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  {
    const g0 = ah.segs[0], g1 = ah.segs[ah.segs.length - 1];
    const 어깨 = 단위2([민.points.SP.x - 민.points.SNP.x, 민.points.SP.y - 민.points.SNP.y]);
    const t0 = 단위2([g0.c1[0] - g0.p0[0], g0.c1[1] - g0.p0[1]]);
    near(t0[0] * 어깨[0] + t0[1] * 어깨[1], 0, '진동이 SP 에서 어깨선과 직각', 1e-9);

    const side = 민.segments.find((s) => s.id === 'side');
    const sd = 단위2([side.pts[1][0] - side.pts[0][0], side.pts[1][1] - side.pts[0][1]]);
    const t1 = 단위2([g1.p1[0] - g1.c2[0], g1.p1[1] - g1.c2[1]]);
    const ang = Math.acos(Math.max(-1, Math.min(1, t1[0] * sd[0] + t1[1] * sd[1]))) * 180 / Math.PI;
    if (Math.abs(ang - 90) > 2) bad(`진동이 옆선과 ${ang.toFixed(1)}도로 만난다 (90도여야 한다)`);

    // 겨드랑보다 아래로 처지면 안 된다 (닮음변환만 쓰면 0.24cm 처졌다)
    const 최저 = Math.max(...ah.pts.map((p) => p[1]));
    if (최저 > 민.points.UA.y + 0.02) bad(`진동이 겨드랑보다 ${(최저 - 민.points.UA.y).toFixed(2)}cm 아래로 처진다`);
  }

  /* 원형의 성격이 남았는가 — 옮긴 곡선의 1/3·2/3 지점을 실제로 지나야 한다.
   * 이게 없으면 "원형에서 따왔다" 가 말뿐이 되고 아무 곡선이나 넣어도 통과한다. */
  {
    const 원형 = 열기('block-mudart-front.draft.json');
    const src = 원형.segments.find((s) => s.id === 'armhole').pts;
    const s0 = src[0], s1 = src[src.length - 1];
    const t0 = [민.points.SP.x, 민.points.SP.y], t1 = [민.points.UA.x, 민.points.UA.y];
    const dsx = s0[0] - s1[0], dsy = s0[1] - s1[1], den = dsx * dsx + dsy * dsy;
    const dtx = t0[0] - t1[0], dty = t0[1] - t1[1];
    const ar = (dtx * dsx + dty * dsy) / den, ai = (dty * dsx - dtx * dsy) / den;
    const moved = src.map((p) => {
      const rx = p[0] - s1[0], ry = p[1] - s1[1];
      return [t1[0] + ar * rx - ai * ry, t1[1] + ai * rx + ar * ry];
    });
    const acc = [0];
    for (let i = 1; i < moved.length; i++) acc.push(acc[i - 1] + Math.hypot(moved[i][0] - moved[i - 1][0], moved[i][1] - moved[i - 1][1]));
    const total = acc[acc.length - 1];
    const 지점 = (f) => {
      const 목표 = total * f;
      for (let i = 1; i < moved.length; i++) {
        if (acc[i] >= 목표) {
          const r = (목표 - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
          return [moved[i - 1][0] + (moved[i][0] - moved[i - 1][0]) * r,
                  moved[i - 1][1] + (moved[i][1] - moved[i - 1][1]) * r];
        }
      }
      return moved[moved.length - 1];
    };
    /* 원형에서 얼마나 벌어졌는지를 **전 구간** 잰다. "1/3·2/3 두 점을 지나는가" 로만 보면
     * 그 사이가 벌어져도 통과한다 — 실제로 두 점만 쓸 때 0.44cm 벌어졌다.
     * 남는 차이는 끝 접선을 고친 자리에 몰려 있어야 하며, 그건 의도한 것이다. */
    const 거리 = (pts, q) => {
      let bd = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
        const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
        const t = L2 > 1e-18 ? Math.max(0, Math.min(1, ((q[0] - x1) * dx + (q[1] - y1) * dy) / L2)) : 0;
        bd = Math.min(bd, Math.hypot(q[0] - (x1 + dx * t), q[1] - (y1 + dy * t)));
      }
      return bd;
    };
    let 최대 = 0;
    for (const q of moved) 최대 = Math.max(최대, 거리(ah.pts, q));
    if (최대 > 0.4) bad(`진동이 옮긴 원형에서 ${최대.toFixed(3)}cm 벌어졌다 (0.4 이내여야 원형 성격이 남는다)`);
    // 아예 붙어 있으면 끝 바로잡기를 안 한 것이다 — 그러면 각이 진 채로 통과한다
    if (최대 < 0.01) bad(`진동이 옮긴 원형과 사실상 같다 (${최대.toFixed(4)}) — 끝 바로잡기를 안 했나`);

    if (!(ah.derived.trued)) bad('진동이 끝 바로잡기(true up)를 안 했다');
    if (!(ah.derived.scale > 1)) bad(`진동 배율이 ${ah.derived.scale} 다 (원형보다 커져야 한다 — 어깨가 좁아지고 겨드랑이 올라갔으므로)`);
  }
}

/* ── 치수선 (dims) — "모든 패턴에는 제도선과 치수 공식을 넣는다"
 *
 * 값만 적힌 도면은 나중에 "이 23.0 이 어디서 나왔나" 를 못 되짚는다. 그래서 label 에
 * 교재 식을 그대로 넣고, 치수선은 **조각 안쪽**에 둔다(바깥이면 인쇄·네스팅에서 잘린다). */
{
  const 민 = 스캔앞판();
  if (!민.dims.length) bad('오버블라우스 앞판에 치수선이 하나도 없다');

  // 교재 값과 실제 제도 결과가 일치하는가 — 식을 잘못 옮기면 여기서 갈린다
  const 기대 = { d_ahd: 21.5, d_bust: 23.0, d_waist: 19.5, d_hip: 24.0,
                 d_hiplen: 19.0, d_len: 58.4, d_drop: 1.0, d_shw: 6.4, d_fnd: 86 / 12 + 0.3 + 6.4 };
  for (const [id, want] of Object.entries(기대)) {
    const d = 민.dims.find((x) => x.id === id);
    if (!d) { bad(`치수선 '${id}' 가 없다`); continue; }
    near(d.length, want, `치수선 ${id} (${d.label})`, 0.005);
  }

  /* ★ 치수선이 조각 안쪽에 있는가. 글자 자리까지 쳐서 완성선 바깥으로 나가면 안 된다.
   *   바깥으로 빼면 A4 분할 인쇄·네스팅에서 잘려 나간다. */
  const cb = 민.cutBbox, 여유 = 0.6;
  for (const d of 민.dims) {
    const L = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) || 1;
    const nx = -(d.b[1] - d.a[1]) / L, ny = (d.b[0] - d.a[0]) / L;
    for (const p of [d.a, d.b]) {
      const x = p[0] + nx * d.offset, y = p[1] + ny * d.offset;
      if (x < cb.x0 - 여유 || x > cb.x1 + 여유 || y < cb.y0 - 여유 || y > cb.y1 + 여유) {
        bad(`치수선 '${d.id}'(${d.label})가 조각 바깥으로 나갔다 (${x.toFixed(1)}, ${y.toFixed(1)})`
          + ` — 조각은 x ${cb.x0.toFixed(1)}~${cb.x1.toFixed(1)} · y ${cb.y0.toFixed(1)}~${cb.y1.toFixed(1)}`);
        break;
      }
    }
  }

  // label 이 비면 값만 남아 쓸모가 없다
  for (const d of 민.dims) if (!String(d.label).trim()) bad(`치수선 '${d.id}' 에 식(label)이 없다`);
}

/* ── 무다트 원형의 치수선
 *
 * 축 성분(axis)을 안 쓰고 두 점 사이 실거리로 재면 옆목 올림·어깨 경사가 섞여
 * "어깨너비/2 = 19.83" 처럼 식과 값이 어긋난다. 실제로 그랬다 — 그래서 여기서 못 박는다. */
for (const [파일, 기대] of [
  ['block-mudart-front.draft.json', { d_nw: 6.6, d_fnd: 86 / 12 + 0.3, d_ahd: 21.5, d_bust: 23.0, d_len: 38, d_sw: 19.5 }],
  ['block-mudart-back.draft.json', { d_nw: 6.6, d_bnd: 2.2, d_ahd: 21.5, d_bust: 23.4, d_len: 38 }],
]) {
  const d = 열기(파일);
  if (!d.dims.length) bad(`${파일} 에 치수선이 없다`);
  for (const [id, want] of Object.entries(기대)) {
    const x = d.dims.find((v) => v.id === id);
    if (!x) { bad(`${파일}: 치수선 '${id}' 가 없다`); continue; }
    near(x.length, want, `${파일} ${id} (${x.label})`, 0.005);
  }
  // 원형은 무다트다 — 옆선이 수직이어야 한다(다트로 뺄 여유가 없다)
  const side = d.segments.find((v) => v.id === 'side');
  near(side.pts[0][0], side.pts[side.pts.length - 1][0], `${파일} 옆선이 수직 (무다트)`, 1e-12);
  if (d.darts.length) bad(`${파일}: 무다트 원형인데 다트가 ${d.darts.length}개 있다`);
}

/* ── 앞뒤판이 실제로 맞물리는가 (봉제 조건)
 *
 * 어깨선·옆선은 앞뒤를 박아 붙이는 선이다. 길이가 안 맞으면 못 꿰맨다.
 * 뒤 어깨는 앞보다 **이세만큼 길어야** 한다 — 견갑골 위로 넣는 여유다.
 * 뒤 경사만 완만하게 주고 이세를 빼먹으면 뒤가 오히려 짧아진다(실제로 0.14cm 짧았다). */
for (const [이름, 앞, 뒤, 이세] of [
  ['무다트 원형', 'block-mudart-front.draft.json', 'block-mudart-back.draft.json', 0.7],
  ['오버블라우스', 'overblouse-mudart-front.draft.json', 'overblouse-mudart-back.draft.json', 0],
]) {
  const F = 열기(앞), B = 열기(뒤);
  const len = (d, id) => d.segments.find((s) => s.id === id).length;
  near(len(B, 'shoulder') - len(F, 'shoulder'), 이세, `${이름}: 뒤 어깨 = 앞 어깨 + 이세 ${이세}`, 0.005);
  const 옆차 = Math.abs(len(B, 'side') - len(F, 'side'));
  if (옆차 > 0.15) bad(`${이름}: 앞뒤 옆선 길이가 ${옆차.toFixed(2)}cm 다르다 — 박을 수 없다`);
}

// 사이즈를 바꿔도 어깨 이세가 유지되는가 (참조가 끊기면 여기서 갈린다)
for (const B of [78, 98]) {
  const f = loadDraft(예제경로('block-mudart-front.draft.json'), { B }).drawing;
  const b = loadDraft(예제경로('block-mudart-back.draft.json'), { B }).drawing;
  const len = (d, id) => d.segments.find((s) => s.id === id).length;
  near(len(b, 'shoulder') - len(f, 'shoulder'), 0.7, `B=${B} 에서도 뒤 어깨 이세 0.7`, 0.005);
}

// 소매산 높이 치수선이 소매길이를 재고 있지 않은지 (실제로 그랬다)
{
  const sl = 열기('bunka-sleeve.draft.json');
  const sc = sl.dims.find((v) => v.id === 'd_sc');
  const cap = sl.segments.find((v) => v.id === 'cap');
  near(sc.length, cap.derived.SC, '소매산 높이 치수선 = 실제 소매산 높이', 1e-9);
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
