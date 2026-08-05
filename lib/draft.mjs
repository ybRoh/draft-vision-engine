/* DSL → 도형. 이 파일이 엔진의 심장이다.
 *
 * 좌표계: x 오른쪽 +, **y 아래 +** (화면·기존 패턴 앱들과 동일).
 * 단위: cm.
 *
 * 점은 서로를 참조하므로(어깨끝은 옆목점을 알아야 한다) 위상정렬로 푼다.
 * 참조 고리가 있으면 어디서 도는지 이름을 찍어 알려준다.
 */

import { evalExpr, deps, ExprError } from './expr.mjs';
import { through, flatten, segsLen, polyLen, lineIntersect, fsArmhole, fsNeck, sleevelessArmhole, bunkaSleeveCap, V } from './curve.mjs';

export class DraftError extends Error {
  constructor(msg) { super(msg); this.name = 'DraftError'; }
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 점 하나가 의존하는 다른 점 이름들.
 *  식 문법 오류가 여기서 먼저 터지므로 어느 점·어느 칸인지 꼭 붙여서 던진다 —
 *  안 그러면 가장 흔한 실패(모델이 식을 잘못 씀)가 가장 나쁜 메시지를 낸다. */
function pointDeps(p) {
  const d = new Set();
  const fromExpr = (e, field) => {
    try { deps(e).forEach((n) => d.add(n)); }
    catch (err) {
      if (err instanceof ExprError) throw new DraftError(`점 '${p.id}'.${field} — ${err.message}`);
      throw err;
    }
  };
  switch (p.kind) {
    case 'xy': fromExpr(p.x, 'x'); fromExpr(p.y, 'y'); break;
    case 'offset': d.add(p.from); fromExpr(p.dx, 'dx'); fromExpr(p.dy, 'dy'); break;
    case 'polar': d.add(p.from); fromExpr(p.angle, 'angle'); fromExpr(p.dist, 'dist'); break;
    case 'on': d.add(p.a); d.add(p.b); fromExpr(p.t, 't'); break;
    case 'along': fromExpr(p.t, 't'); break;   // 선 의존은 위상정렬에서 따로 건다
    case 'intersect': [p.a1, p.a2, p.b1, p.b2].forEach((n) => d.add(n)); break;
    default: throw new DraftError(`점 '${p.id}': 모르는 kind '${p.kind}'`);
  }
  return d;
}

function placePoint(p, scope, segOut) {
  const E = (e, field) => {
    try { return evalExpr(e, scope); }
    catch (err) {
      if (err instanceof ExprError) throw new DraftError(`점 '${p.id}'.${field} — ${err.message}`);
      throw err;
    }
  };
  const P = (id) => {
    const v = scope[id];
    if (v == null) throw new DraftError(`점 '${p.id}': 기준점 '${id}' 이 아직 없다`);
    if (typeof v !== 'object' || typeof v.x !== 'number') {
      throw new DraftError(`점 '${p.id}': '${id}' 은 점이 아니라 치수·상수다`);
    }
    return [v.x, v.y];
  };
  switch (p.kind) {
    case 'xy': return [E(p.x, 'x'), E(p.y, 'y')];
    case 'offset': { const f = P(p.from); return [f[0] + E(p.dx, 'dx'), f[1] + E(p.dy, 'dy')]; }
    case 'polar': {
      const f = P(p.from), a = E(p.angle, 'angle') * Math.PI / 180, r = E(p.dist, 'dist');
      // y 가 아래로 +이므로 각도 양수(반시계, 화면상 위)는 y 를 줄인다
      return [f[0] + r * Math.cos(a), f[1] - r * Math.sin(a)];
    }
    case 'on': {
      const a = P(p.a), b = P(p.b), t = E(p.t, 't');
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    case 'along': {
      /* 곡선 위를 **실제로 따라간 길이**로 잡는다. on(직선 비율)로 잡으면 곡선에서는
       * 어긋난다 — 합인 너치처럼 상대 조각과 맞물려야 하는 점에서는 그 차이가 그대로 오차다. */
      const seg = segOut.get(p.seg);
      if (!seg) throw new DraftError(`점 '${p.id}': 선 '${p.seg}' 이 아직 없다`);
      const pts = p.from === 'end' ? [...seg.pts].reverse() : seg.pts;
      const 목표 = E(p.t, 't') * seg.length;
      if (!(목표 >= -1e-9)) throw new DraftError(`점 '${p.id}': t 가 음수다 (${p.t})`);
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (acc + d >= 목표) {
          const f = d > 1e-12 ? (목표 - acc) / d : 0;
          return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f,
                  pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
        }
        acc += d;
      }
      return pts[pts.length - 1];       // t>=1 이면 반대쪽 끝
    }
    case 'intersect': {
      const x = lineIntersect(P(p.a1), P(p.a2), P(p.b1), P(p.b2));
      if (x === 'degenerate') {
        throw new DraftError(`점 '${p.id}': ${p.a1}-${p.a2} 또는 ${p.b1}-${p.b2} 가 같은 점이라 직선이 안 된다`);
      }
      if (x === 'parallel') {
        throw new DraftError(`점 '${p.id}': ${p.a1}-${p.a2} 와 ${p.b1}-${p.b2} 가 평행이라 교점이 없다`);
      }
      return x;
    }
  }
}

/** 선 kind 별로 점 id 가 든 칸 (draft/validate 가 같은 표를 본다) */
const SEG_POINTS = {
  line: (s) => s.pts,
  curve: (s) => s.through,
  neck: (s) => [s.center, s.snp, s.shoulder, s.via].filter(Boolean),
  armhole: (s) => [s.shoulder, s.neck, s.pitch, s.bottom],
  armhole_sleeveless: (s) => [s.shoulder, s.neck, s.pitch, s.bottom, s.side],
  traced: (s) => [s.start, s.end, s.startPerp, s.endPerp].filter(Boolean),
  sleevecap: (s) => [s.apex],
};
/** 선 kind 별로 계산식이 든 칸 */
const SEG_EXPRS = { armhole_sleeveless: ['scoop'], sleevecap: ['frontAH', 'backAH', 'capHeight', 'frontReduce', 'backReduce', 'frontRise', 'backRise'] };
/** 선이 만들어 내는 점들 (역산 결과라 식으로는 못 쓰는 값) */
const SEG_PRODUCES = {
  sleevecap: (s) => [s.produces.front, s.produces.back, s.produces.notchFront, s.produces.notchBack],
};

/** 베지어 구간 배열을 거꾸로 (뒤 소매산을 겨드랑→정점 방향으로 돌릴 때) */
const 되돌리기 = (segs) => segs.slice().reverse().map((g) => ({ p0: g.p1, c1: g.c2, c2: g.c1, p1: g.p0 }));

/** 선 하나를 실제 도형으로. 점을 만들어 내는 kind 는 `놓기` 로 등록한다. */
function buildSegment(s, scope, P, 놓기, compareGeom) {
  if (s.kind === 'line') {
    const pts = s.pts.map(P);
    if (s.closed) pts.push(pts[0]);
    return { id: s.id, desc: s.desc, layer: s.layer, kind: 'line', pts, length: polyLen(pts), derived: null };
  }
  const E = (e, field) => {
    try { return evalExpr(e, scope); }
    catch (err) {
      if (err instanceof ExprError) throw new DraftError(`선 '${s.id}'.${field} — ${err.message}`);
      throw err;
    }
  };
  /* 목선·암홀·소매산은 제도법이 곡선을 정한다 — 통과점을 받지 않고 제도점에서 직접 만든다.
   * derived 에 품점·오목점·소매산 정보를 실어 보낸다. 교재가 너치를 거는 자리라 쓸 데가 있다. */
  let segs, derived = null;
  try {
    if (s.kind === 'neck') {
      segs = fsNeck(P(s.center), P(s.snp), V.sub(P(s.shoulder), P(s.snp)), s.via ? P(s.via) : null);
    } else if (s.kind === 'armhole') {
      const a = fsArmhole(P(s.shoulder), P(s.neck), P(s.pitch)[0], P(s.bottom));
      segs = a.segs;
      derived = { pitch: a.pitch, hollow: a.hollow };
    } else if (s.kind === 'armhole_sleeveless') {
      const a = sleevelessArmhole(P(s.shoulder), P(s.neck), P(s.pitch), P(s.bottom), E(s.scoop, 'scoop'), P(s.side));
      segs = a.segs;
      derived = { scoopPt: a.scoopPt, endTangent: a.endTangent };
    } else if (s.kind === 'traced') {
      /* 원형의 선을 물려받아 양 끝을 새 두 점에 붙인다.
       *
       * **닮음변환(회전+균일축소+평행이동)** 을 쓴다. 두 점을 두 점으로 보내는 변환 중
       * 각도를 보존하는 유일한 것이라, 원형 곡선의 **모양이 그대로 남는다** — 굽은 정도,
       * 오목한 자리, 끝에서의 접선 방향까지.
       *
       * 끝점 이동량을 길이비율로 섞는 방식(전단)도 두 끝은 맞지만 중간이 찌그러진다.
       * 그러면 "원형에서 따왔다" 가 말뿐이 된다. 복소수 곱 하나로 끝나는 계산이다. */
      const g = compareGeom[s.compare];
      if (!g) throw new DraftError(`선 '${s.id}': 비교패턴 '${s.compare}' 이 없다 (compare 절에 넣었나)`);
      const src = g.segs?.find((x) => x.id === s.seg);
      if (!src) {
        throw new DraftError(`선 '${s.id}': '${g.name}' 에 완성선 '${s.seg}' 이 없다`
          + ` (있는 것: ${(g.segs ?? []).map((x) => x.id).join(', ')})`);
      }
      const s0 = src.pts[0], s1 = src.pts[src.pts.length - 1];
      const t0 = P(s.start), t1 = P(s.end);
      const dsx = s0[0] - s1[0], dsy = s0[1] - s1[1];
      const den = dsx * dsx + dsy * dsy;
      if (!(den > 1e-12)) throw new DraftError(`선 '${s.id}': 원형 '${s.seg}' 의 양 끝이 같은 점이다`);
      const dtx = t0[0] - t1[0], dty = t0[1] - t1[1];
      // a = (t0−t1)/(s0−s1)  (복소수 나눗셈)
      const ar = (dtx * dsx + dty * dsy) / den;
      const ai = (dty * dsx - dtx * dsy) / den;
      const moved = src.pts.map((p) => {
        const rx = p[0] - s1[0], ry = p[1] - s1[1];
        return [t1[0] + ar * rx - ai * ry, t1[1] + ai * rx + ar * ry];
      });
      const 배율 = Math.hypot(ar, ai);
      const 회전 = Math.atan2(ai, ar) * 180 / Math.PI;

      /* 옮긴 뒤 **끝을 참되게 고친다(true up)**.
       * 닮음변환은 모양을 그대로 살리지만 끝 접선까지 같이 돌린다. 원형이 어깨선·옆선과
       * 직각이었어도 20도 돌면 그만큼 각이 진다 — 앞뒤판을 박았을 때 진동에 꺾임이 생기고
       * 거기서 실이 뜯긴다. 실무에서도 원형을 대고 그린 뒤 양 끝을 바로잡는다.
       * 옮긴 곡선의 1/3·2/3 지점을 지나게 해 성격은 남기고 접선만 고쳐 다시 그린다. */
      let outPts = moved, outSegs = null;
      if (s.startPerp || s.endPerp) {
        const 수직 = (기준, 끝, 향할곳) => {
          const d = V.norm(V.sub(끝, 기준));
          let n2 = [d[1], -d[0]];
          if (n2[0] * (향할곳[0] - 끝[0]) + n2[1] * (향할곳[1] - 끝[1]) < 0) n2 = [-n2[0], -n2[1]];
          return n2;
        };
        const mid = (f) => {
          const acc = [0];
          for (let i = 1; i < moved.length; i++) acc.push(acc[i - 1] + V.dist(moved[i - 1], moved[i]));
          const 목표 = acc[acc.length - 1] * f;
          for (let i = 1; i < moved.length; i++) {
            if (acc[i] >= 목표) {
              const r = (목표 - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
              return [moved[i - 1][0] + (moved[i][0] - moved[i - 1][0]) * r,
                      moved[i - 1][1] + (moved[i][1] - moved[i - 1][1]) * r];
            }
          }
          return moved[moved.length - 1];
        };
        /* 통과점이 도착점보다 아래로 내려가지 않게 막는다. 옮긴 원형이 회전 때문에 끝 근처에서
         * 살짝 내려가는 일이 있는데, 그대로 두면 진동이 겨드랑 아래로 처진다. */
        const 한계 = (q) => [q[0], Math.min(q[1], Math.max(t0[1], t1[1]))];
        const t0v = s.startPerp ? 수직(P(s.startPerp), t0, t1) : null;
        const t1v = s.endPerp ? 수직(P(s.endPerp), t1, t0).map((v) => -v) : null;
        /* 통과점 1/4·1/2·3/4, tension 0.25.
         * tension 을 기본값 0.42 로 두면 통과점 사이에서 곡선이 부풀어 겨드랑보다 0.16cm
         * 아래로 처진다(중간 통과점의 자동 접선이 UA 아래로 내려간다). 0.25 면 처짐이
         * 사라지고 원형과의 벌어짐도 0.42cm 로 비슷하다.
         * 2개(1/3·2/3)면 그 사이가 0.44cm 벌어지고, 5개까지 늘리면 0.24cm 로 줄지만
         * 마지막 점이 겨드랑보다 낮아 곡선이 0.17cm 처진다 — 진동이 겨드랑 아래로
         * 내려가면 안 된다. 셋이 처짐 없이 가장 잘 붙는다(0.34cm). */
        outSegs = through([t0, 한계(mid(0.25)), 한계(mid(0.5)), 한계(mid(0.75)), t1], t0v, t1v, 0.25);
        outPts = flatten(outSegs);
      }
      return { id: s.id, desc: s.desc, layer: s.layer, kind: 'traced', segs: outSegs,
               derived: { from: `${s.compare}.${s.seg}`, scale: 배율, rotate: 회전,
                          trued: Boolean(s.startPerp || s.endPerp) },
               pts: outPts, length: outSegs ? segsLen(outSegs) : polyLen(outPts) };
    } else if (s.kind === 'sleevecap') {
      const cap = bunkaSleeveCap(E(s.frontAH, 'frontAH'), E(s.backAH, 'backAH'), {
        capHeight: E(s.capHeight, 'capHeight'),
        frontReduce: E(s.frontReduce, 'frontReduce'), backReduce: E(s.backReduce, 'backReduce'),
        frontRise: E(s.frontRise, 'frontRise'), backRise: E(s.backRise, 'backRise'),
      });
      const a = P(s.apex);
      const mv = (p) => [p[0] + a[0], p[1] + a[1]];
      const 옮김 = (gs) => gs.map((g) => ({ p0: mv(g.p0), c1: mv(g.c1), c2: mv(g.c2), p1: mv(g.p1) }));
      // 뒤 겨드랑 → 정점 → 앞 겨드랑 하나로 잇는다. 뒤쪽은 정점에서 출발하게 만들어졌으니 뒤집는다
      segs = [...되돌리기(옮김(cap.back)), ...옮김(cap.front)];
      놓기(s.produces.front, mv(cap.fc), '앞 겨드랑 코너 (소매산에서 역산)');
      놓기(s.produces.back, mv(cap.bc), '뒤 겨드랑 코너 (소매산에서 역산)');
      놓기(s.produces.notchFront, mv(cap.notchF), '앞 소매산 합인 너치');
      놓기(s.produces.notchBack, mv(cap.notchB), '뒤 소매산 합인 너치');
      derived = { SC: cap.SC, capLen: cap.capLen, lenF: cap.lenF, lenB: cap.lenB,
                  chordF: cap.chordF, chordB: cap.chordB, ease: cap.ease, AH: cap.AH,
                  notchArcF: cap.notchArcF, notchArcB: cap.notchArcB };
    } else {
      segs = through(s.through.map(P), null, null, s.tension ?? 0.42);
    }
  } catch (e) {
    if (e instanceof DraftError) throw e;
    throw new DraftError(`선 '${s.id}' — ${e.message}`);
  }
  for (const g of segs) {
    for (const p of [g.p0, g.c1, g.c2, g.p1]) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        throw new DraftError(`선 '${s.id}': 곡선 좌표가 숫자가 아니다 — 제도점 배치를 확인하라`);
      }
    }
  }
  // 길이는 폴리라인이 아니라 베지어에서 잰다. 24분할 폴리라인은 급곡선에서 0.01cm 넘게 짧게 나온다
  return { id: s.id, desc: s.desc, layer: s.layer, kind: s.kind, segs, derived,
           pts: flatten(segs), length: segsLen(segs) };
}

/**
 * DSL 을 실제 좌표로 푼다.
 * @param spec      draft-spec v1
 * @param overrides 치수 덮어쓰기 {B: 92, WL: 39} — 그레이딩·사이즈 변경에 쓴다
 * @param refValues spec.refs 의 id → 숫자. **다른 조각에서 실측해 온 값**이다.
 *                  파일을 읽는 일은 여기서 하지 않는다(이 함수는 순수하게 둔다) —
 *                  lib/project.mjs 가 의존 그래프를 풀어 넘겨준다.
 * @param compareGeom spec.compare 의 id → 그 원형의 도형(완성선 폴리라인 배열). 역시 project.mjs 가 넘긴다.
 */
export function resolve(spec, overrides = {}, refValues = {}, compareGeom = {}) {
  // ── 1. 참조값·치수·상수 → scope
  //  scope 는 프로토타입 없는 객체여야 한다. 안 그러면 'toString' 같은 이름의 치수가
  //  상속 메서드에 가려 선언값을 잃는다.
  const scope = Object.create(null);
  const measures = Object.create(null);
  const pick = (id, dflt) => (has(overrides, id) && overrides[id] !== undefined ? overrides[id] : dflt);
  for (const r of spec.refs ?? []) {
    if (!has(refValues, r.id)) throw new DraftError(`참조 '${r.id}' 의 값이 안 넘어왔다 (lib/project.mjs 로 열어야 한다)`);
    const v = refValues[r.id];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new DraftError(`참조 '${r.id}' 값이 숫자가 아니다 (${JSON.stringify(v)})`);
    scope[r.id] = v;
  }
  for (const m of spec.measures) {
    if (m.id in scope) throw new DraftError(`measures '${m.id}' 가 refs 와 이름이 겹친다`);
    const v = pick(m.id, m.value);
    scope[m.id] = v; measures[m.id] = v;
  }
  for (const p of spec.params) {
    if (p.id in scope) throw new DraftError(`params '${p.id}' 가 measures·refs 와 이름이 겹친다`);
    scope[p.id] = pick(p.id, p.value);
  }
  for (const k of Object.keys(overrides)) {
    if ((spec.refs ?? []).some((r) => r.id === k)) {
      throw new DraftError(`'${k}' 는 다른 조각에서 실측해 오는 참조라 덮어쓸 수 없다 — 원본 조각의 치수를 바꿔라`);
    }
    if (!(k in scope)) throw new DraftError(`덮어쓸 '${k}' 가 measures/params 에 없다`);
    const v = overrides[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new DraftError(`덮어쓴 '${k}' 값이 숫자가 아니다 (${JSON.stringify(v)})`);
    }
  }

  if (!spec.points.length) throw new DraftError('점이 하나도 없다 — 그릴 것이 없는 도면');

  /* ── 2. 점 · 선 통합 위상정렬
   *
   * 점만 먼저 풀고 선을 나중에 그리면 소매를 못 그린다. 소매산 폭은 "곡선 길이 = 암홀+이세"
   * 가 되도록 **이분탐색으로 역산**하는 값이라 식으로 못 쓰는데, 소맷부리·옆선은 그렇게
   * 나온 겨드랑 코너를 기준으로 잡히기 때문이다. 그래서 선도 점을 만들어 낼 수 있게 하고
   * (produces), 점과 선을 한 그래프에 넣어 순서를 푼다. */
  const points = Object.create(null);
  const segById = new Map(spec.segments.map((s) => [s.id, s]));
  for (const c of spec.compare ?? []) {
    if (!compareGeom[c.id]) throw new DraftError(`비교패턴 '${c.id}' 의 도형이 안 넘어왔다 (lib/project.mjs 로 열어야 한다)`);
  }
  const pointById = new Map(spec.points.map((p) => [p.id, p]));

  // 어느 선이 어느 점을 만들어 내는가
  const producedBy = new Map();
  for (const s of spec.segments) {
    for (const id of SEG_PRODUCES[s.kind]?.(s) ?? []) {
      if (pointById.has(id)) throw new DraftError(`선 '${s.id}' 가 만드는 점 '${id}' 이 points 에도 있다`);
      if (producedBy.has(id)) throw new DraftError(`점 '${id}' 을 '${producedBy.get(id)}' 와 '${s.id}' 가 둘 다 만든다`);
      producedBy.set(id, s.id);
    }
  }

  const key = (t, id) => `${t}:${id}`;
  const 이름의출처 = (n, 쓴곳) => {
    if (pointById.has(n)) return key('p', n);
    if (producedBy.has(n)) return key('s', producedBy.get(n));
    throw new DraftError(`${쓴곳} 가 모르는 이름 '${n}' 을 쓴다 (점·치수·상수 어디에도 없다)`);
  };

  const nodes = new Map();
  for (const p of spec.points) {
    const d = [...pointDeps(p)].filter((n) => !(n in scope));
    const need = new Set(d.map((n) => 이름의출처(n, `점 '${p.id}'`)));
    // along 은 선을 따라가므로 그 선이 먼저 풀려야 한다
    if (p.kind === 'along') {
      if (!segById.has(p.seg)) throw new DraftError(`점 '${p.id}' 가 모르는 선 '${p.seg}' 을 가리킨다`);
      need.add(key('s', p.seg));
    }
    nodes.set(key('p', p.id), { kind: 'point', spec: p, need });
  }
  for (const s of spec.segments) {
    const d = new Set();
    for (const id of SEG_POINTS[s.kind]?.(s) ?? []) d.add(이름의출처(id, `선 '${s.id}'`));
    for (const f of SEG_EXPRS[s.kind] ?? []) {
      let names;
      try { names = deps(s[f]); }
      catch (err) {
        if (err instanceof ExprError) throw new DraftError(`선 '${s.id}'.${f} — ${err.message}`);
        throw err;
      }
      for (const n of names) if (!(n in scope)) d.add(이름의출처(n, `선 '${s.id}'.${f}`));
    }
    nodes.set(key('s', s.id), { kind: 'seg', spec: s, need: d });
  }

  const 놓기 = (id, xy, desc) => {
    const [x, y] = xy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DraftError(`점 '${id}' 좌표가 숫자가 아니다 (${x}, ${y})`);
    points[id] = { x, y, desc };
    scope[id] = points[id];
  };
  const P = (id) => {
    const v = points[id];
    if (!v) throw new DraftError(`점 '${id}' 이 아직 없다`);
    return [v.x, v.y];
  };

  const segOut = new Map();
  const done = new Set();
  const order = [];
  for (let pass = 0; pass <= nodes.size; pass++) {
    let moved = false;
    for (const [k, node] of nodes) {
      if (done.has(k)) continue;
      if ([...node.need].some((n) => !done.has(n))) continue;
      if (node.kind === 'point') {
        놓기(node.spec.id, placePoint(node.spec, scope, segOut), node.spec.desc);
        order.push(node.spec.id);
      } else {
        segOut.set(node.spec.id, buildSegment(node.spec, scope, P, 놓기, compareGeom));
      }
      done.add(k); moved = true;
    }
    if (!moved || done.size === nodes.size) break;
  }
  if (done.size < nodes.size) {
    const detail = [...nodes].filter(([k]) => !done.has(k))
      .map(([k, n]) => `${k} → ${[...n.need].filter((x) => !done.has(x)).join(', ')}`);
    throw new DraftError(`참조가 고리를 이룬다:\n  ${detail.join('\n  ')}`);
  }

  // ── 3. 선 (위 위상정렬에서 이미 만들었다. spec 순서대로 돌려준다)
  const segments = spec.segments.map((s) => segOut.get(s.id));

  // ── 4. 다트·너치
  const darts = spec.darts.map((d) => ({
    id: d.id, desc: d.desc,
    apex: P(d.apex), leg1: P(d.leg1), leg2: P(d.leg2),
    width: V.dist(P(d.leg1), P(d.leg2)),
  }));
  const notches = spec.notches.map((n) => ({ id: n.id, desc: n.desc, at: P(n.at) }));

  /* 원형비교패턴 — 다른 조각의 완성선을 빨간 가는 선으로 겹쳐 그린다.
   * cutBbox 에는 **넣지 않는다.** 이 조각의 크기가 아니기 때문이다 —
   * 넣으면 그레이딩 검증과 용지 배치가 남의 조각 크기를 따라간다. */
  const compares = (spec.compare ?? []).map((c) => {
    const g = compareGeom[c.id];
    if (!g) throw new DraftError(`비교패턴 '${c.id}' 의 도형이 안 넘어왔다 (lib/project.mjs 로 열어야 한다)`);
    const dx = evalExpr(c.dx, scope), dy = evalExpr(c.dy, scope);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new DraftError(`비교패턴 '${c.id}': dx/dy 가 숫자가 아니다`);
    return { id: c.id, desc: c.desc, name: g.name,
             lines: g.lines.map((pts) => pts.map((p) => [p[0] + dx, p[1] + dy])) };
  });

  /* 치수선 — 도해에 적힌 식을 도면에 그대로 얹는다.
   * 값(cm)만 있으면 나중에 "이 숫자가 어디서 나왔나" 를 되짚을 수 없다. 식이 같이 보여야
   * 사이즈를 바꿨을 때 무엇이 따라 움직이는지 읽힌다. */
  const dims = (spec.dims ?? []).map((d) => {
    const a0 = P(d.a), b0 = P(d.b);
    /* 교재 치수선은 대개 축에 나란하다. 두 점 사이 실거리로 재면 옆목 올림·어깨 경사 같은
     * 성분이 섞여 "어깨너비/2 = 19.83" 처럼 식과 값이 어긋난다. 축 성분만 재도록 투영한다. */
    const axis = d.axis ?? 'both';
    const a = a0;
    const b = axis === 'x' ? [b0[0], a0[1]] : axis === 'y' ? [a0[0], b0[1]] : b0;
    let off;
    try { off = evalExpr(d.offset, scope); }
    catch (e) {
      if (e instanceof ExprError) throw new DraftError(`치수선 '${d.id}'.offset — ${e.message}`);
      throw e;
    }
    if (!Number.isFinite(off)) throw new DraftError(`치수선 '${d.id}': offset 이 숫자가 아니다`);
    return { id: d.id, desc: d.desc, a, b, axis, label: d.label, offset: off, length: V.dist(a, b) };
  });

  // ── 5. 바운딩박스
  //  bbox    = 보조선·보조점까지 전부 (SVG 액자 잡기용)
  //  cutBbox = 완성선 + 다트 + 너치 (실제 조각 크기 — 그레이딩 검증·용지 배치는 이걸 봐야 한다.
  //            보조점 하나가 멀리 떨어져 있으면 bbox 는 치수를 따라 자라지 않는다)
  //  스프레드(Math.min(...xs))는 정점 12만 개쯤에서 RangeError 가 난다. 곡선이 많은 도면에서
  //  실제로 도달하므로 reduce 로 돈다.
  const box = (lists) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (const list of lists) for (const p of list) {
      n++;
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return n ? { x0, y0, x1, y1 } : null;
  };
  const ptList = Object.values(points).map((p) => [p.x, p.y]);
  const bbox = box([ptList, ...segments.map((s) => s.pts)]) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };

  /* viewBbox = 화면 액자용. construction(제도 보조) 레이어는 **액자를 넓히지 못한다.**
   *
   * 보조선은 교점을 잡으려고 아무 데나 길게 그어 두는 것이다(어깨경사선을 20cm 뻗는다든지,
   * 어깨너비선을 조각 위 5cm 부터 긋는다든지). 그게 bbox 에 들어가면 정작 조각은 작아지고,
   * 화면 밖에 이름표 붙은 점이 떠다니는 것처럼 보인다. 보조선은 그리되 액자는 안 넓힌다. */
  /* 치수선은 완성선 바깥에 놓이는 일이 많다(조각 왼쪽·아래). 액자에 안 넣으면 잘려 나간다.
   * 글자가 치수선보다 더 튀어나오므로 여유를 조금 더 준다. */
  const dimPts = [];
  for (const d of dims) {
    const L = V.dist(d.a, d.b) || 1;
    const nx = -(d.b[1] - d.a[1]) / L, ny = (d.b[0] - d.a[0]) / L;
    const 여유 = d.offset + Math.sign(d.offset || 1) * 1.1;   // 글자 자리
    for (const p of [d.a, d.b]) dimPts.push([p[0] + nx * 여유, p[1] + ny * 여유]);
  }
  const viewBbox = box([
    ...segments.filter((s) => s.layer !== 'construction').map((s) => s.pts),
    darts.map((d) => d.apex), darts.map((d) => d.leg1), darts.map((d) => d.leg2),
    notches.map((n) => n.at), dimPts, ...compares.map((c) => c.lines).flat(),
  ]) ?? bbox;
  const cutBbox = box([
    ...segments.filter((s) => s.layer === 'cut' || s.layer === 'fold').map((s) => s.pts),
    darts.map((d) => d.apex), darts.map((d) => d.leg1), darts.map((d) => d.leg2),
    notches.map((n) => n.at),
  ]) ?? bbox;

  return { name: spec.name, measures, scope, points, order, segments, darts, notches, dims, compares, bbox, viewBbox, cutBbox, notes: spec.notes ?? [] };
}
