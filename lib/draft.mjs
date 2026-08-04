/* DSL → 도형. 이 파일이 엔진의 심장이다.
 *
 * 좌표계: x 오른쪽 +, **y 아래 +** (화면·기존 패턴 앱들과 동일).
 * 단위: cm.
 *
 * 점은 서로를 참조하므로(어깨끝은 옆목점을 알아야 한다) 위상정렬로 푼다.
 * 참조 고리가 있으면 어디서 도는지 이름을 찍어 알려준다.
 */

import { evalExpr, deps, ExprError } from './expr.mjs';
import { through, flatten, segsLen, polyLen, lineIntersect, V } from './curve.mjs';

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
    case 'intersect': [p.a1, p.a2, p.b1, p.b2].forEach((n) => d.add(n)); break;
    default: throw new DraftError(`점 '${p.id}': 모르는 kind '${p.kind}'`);
  }
  return d;
}

function placePoint(p, scope) {
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

/**
 * DSL 을 실제 좌표로 푼다.
 * @param spec      draft-spec v1
 * @param overrides 치수 덮어쓰기 {B: 92, WL: 39} — 그레이딩·사이즈 변경에 쓴다
 */
export function resolve(spec, overrides = {}) {
  // ── 1. 치수·상수 → scope
  //  scope 는 프로토타입 없는 객체여야 한다. 안 그러면 'toString' 같은 이름의 치수가
  //  상속 메서드에 가려 선언값을 잃는다.
  const scope = Object.create(null);
  const measures = Object.create(null);
  const pick = (id, dflt) => (has(overrides, id) && overrides[id] !== undefined ? overrides[id] : dflt);
  for (const m of spec.measures) {
    const v = pick(m.id, m.value);
    scope[m.id] = v; measures[m.id] = v;
  }
  for (const p of spec.params) {
    if (p.id in scope) throw new DraftError(`params '${p.id}' 가 measures 와 이름이 겹친다`);
    scope[p.id] = pick(p.id, p.value);
  }
  for (const k of Object.keys(overrides)) {
    if (!(k in scope)) throw new DraftError(`덮어쓸 '${k}' 가 measures/params 에 없다`);
    const v = overrides[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new DraftError(`덮어쓴 '${k}' 값이 숫자가 아니다 (${JSON.stringify(v)})`);
    }
  }

  if (!spec.points.length) throw new DraftError('점이 하나도 없다 — 그릴 것이 없는 도면');

  // ── 2. 점 위상정렬
  const byId = new Map(spec.points.map((p) => [p.id, p]));
  const need = new Map();
  for (const p of spec.points) {
    // 치수·상수 이름은 이미 알고 있으니 의존에서 뺀다. 남는 건 점 이름이어야 한다.
    const d = [...pointDeps(p)].filter((n) => !(n in scope));
    for (const n of d) if (!byId.has(n)) throw new DraftError(`점 '${p.id}' 가 모르는 이름 '${n}' 을 쓴다 (점·치수·상수 어디에도 없다)`);
    need.set(p.id, new Set(d));
  }

  const points = Object.create(null);
  const order = [];
  for (let pass = 0; pass < spec.points.length; pass++) {
    let moved = false;
    for (const p of spec.points) {
      if (p.id in points) continue;
      if ([...need.get(p.id)].some((n) => !(n in points))) continue;
      const [x, y] = placePoint(p, scope);
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new DraftError(`점 '${p.id}' 좌표가 숫자가 아니다 (${x}, ${y})`);
      }
      points[p.id] = { x, y, desc: p.desc };
      scope[p.id] = points[p.id];
      order.push(p.id);
      moved = true;
    }
    if (!moved || order.length === spec.points.length) break;
  }
  if (order.length < spec.points.length) {
    const stuck = spec.points.filter((p) => !(p.id in points));
    const detail = stuck.map((p) => `${p.id} → ${[...need.get(p.id)].filter((n) => !(n in points)).join(', ')}`);
    throw new DraftError(`점 참조가 고리를 이룬다:\n  ${detail.join('\n  ')}`);
  }

  // ── 3. 선
  const P = (id) => [points[id].x, points[id].y];
  const segments = spec.segments.map((s) => {
    if (s.kind === 'line') {
      const pts = s.pts.map(P);
      if (s.closed) pts.push(pts[0]);
      return { id: s.id, desc: s.desc, layer: s.layer, kind: 'line', pts, length: polyLen(pts) };
    }
    let segs;
    try { segs = through(s.through.map(P), null, null, s.tension ?? 0.42); }
    catch (e) { throw new DraftError(`선 '${s.id}' — ${e.message}`); }
    // 길이는 폴리라인이 아니라 베지어에서 잰다. 24분할 폴리라인은 급곡선에서 0.01cm 넘게 짧게 나온다
    return { id: s.id, desc: s.desc, layer: s.layer, kind: 'curve', segs, pts: flatten(segs), length: segsLen(segs) };
  });

  // ── 4. 다트·너치
  const darts = spec.darts.map((d) => ({
    id: d.id, desc: d.desc,
    apex: P(d.apex), leg1: P(d.leg1), leg2: P(d.leg2),
    width: V.dist(P(d.leg1), P(d.leg2)),
  }));
  const notches = spec.notches.map((n) => ({ id: n.id, desc: n.desc, at: P(n.at) }));

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
  const cutBbox = box([
    ...segments.filter((s) => s.layer === 'cut' || s.layer === 'fold').map((s) => s.pts),
    darts.map((d) => d.apex), darts.map((d) => d.leg1), darts.map((d) => d.leg2),
    notches.map((n) => n.at),
  ]) ?? bbox;

  return { name: spec.name, measures, scope, points, order, segments, darts, notches, bbox, cutBbox, notes: spec.notes ?? [] };
}
