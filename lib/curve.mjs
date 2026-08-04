/* 곡선 — Freesewing(Brian block) 방식의 through 곡선.
 * 기존 패턴 앱들(재킷원형-문화식FS 등)과 같은 알고리즘을 써서 결과가 어긋나지 않게 한다.
 */

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  dist: (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]),
  norm: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
};

export function bez(p0, c1, c2, p1, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
          a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
}

export function bezLen(p0, c1, c2, p1, n = 240) {
  let L = 0, q = p0;
  for (let i = 1; i <= n; i++) { const p = bez(p0, c1, c2, p1, i / n); L += V.dist(q, p); q = p; }
  return L;
}

/**
 * 점들을 부드럽게 지나는 3차 베지어 구간 배열.
 * @param pts     지나갈 점들
 * @param t0v     시작 접선 방향 (없으면 자동)
 * @param t1v     끝 접선 방향
 * @param tension 0.42 가 Freesewing 기본. 0 이면 직선에 가깝다.
 */
export function through(rawPts, t0v, t1v, tension = 0.42) {
  /* 인접한 중복점은 걷어낸다. 그대로 두면 p0=c1=c2=p1 인 퇴화 구간이 생기고,
   * flatten 이 겹친 정점을 24개 뽑아 DXF POLYLINE 에 길이 0 세그먼트를 넣는다. */
  const pts = rawPts.filter((p, i) => i === 0 || Math.hypot(p[0] - rawPts[i - 1][0], p[1] - rawPts[i - 1][1]) > 1e-9);
  if (pts.length < 2) throw new Error('through: 서로 다른 점이 2개 미만이다 (같은 점을 겹쳐 지정했는지 확인)');
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1], d = V.dist(p0, p1);
    let t0, t1;
    if (i === 0) t0 = t0v ? V.norm(t0v) : V.norm(V.sub(p1, p0));
    else t0 = V.norm(V.sub(p1, pts[i - 1]));
    if (i === pts.length - 2) t1 = t1v ? V.norm(t1v) : V.norm(V.sub(p1, p0));
    else t1 = V.norm(V.sub(pts[i + 2], p0));
    segs.push({ p0, c1: V.add(p0, V.mul(t0, d * tension)), c2: V.sub(p1, V.mul(t1, d * tension)), p1 });
  }
  return segs;
}

/** 베지어 구간들 → 폴리라인 (DXF·검증·길이 실측용) */
export function flatten(segs, per = 24) {
  if (!segs?.length) throw new Error('flatten: 빈 구간');
  const out = [segs[0].p0];
  for (const s of segs) for (let i = 1; i <= per; i++) out.push(bez(s.p0, s.c1, s.c2, s.p1, i / per));
  return out;
}

export const segsLen = (segs) => segs.reduce((a, s) => a + bezLen(s.p0, s.c1, s.c2, s.p1), 0);

export function polyLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += V.dist(pts[i - 1], pts[i]);
  return L;
}

/**
 * 두 **무한직선** AB · CD 의 교점 (선분이 아니다 — 짧게 그은 안내선끼리도 만난다).
 * @returns [x,y] · 평행이면 'parallel' · 점 두 개가 겹쳐 직선이 안 되면 'degenerate'
 *
 * 판정에 절대 epsilon 을 쓰면 척도 감각이 없어진다 — 20cm 짜리 두 선이 1e-10cm 어긋난
 * 것을 "만난다" 고 보고 교점을 1e12cm 밖으로 날려 보낸다. 그 점이 bbox 에 들어가면
 * 도면 액자가 통째로 망가진다. 그래서 두 방향벡터 길이에 비례한 상대 epsilon 을 쓴다.
 */
export function lineIntersect(a, b, c, d) {
  const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1], x3 = c[0], y3 = c[1], x4 = d[0], y4 = d[1];
  const la = Math.hypot(x1 - x2, y1 - y2), lc = Math.hypot(x3 - x4, y3 - y4);
  if (la < 1e-12 || lc < 1e-12) return 'degenerate';
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) <= 1e-9 * la * lc) return 'parallel';
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}
