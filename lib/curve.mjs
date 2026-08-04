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

/* ══════════════════════════════════════════════════════════════════════
 * 제도법이 정해진 곡선 — 목선 · 암홀
 *
 * 이 둘은 through 로 그리면 안 된다. through 는 "지나갈 점"을 사람(또는 모델)이
 * 찍어 줘야 하는데, 목선과 암홀은 교재에 **어디를 지나야 하는지가 이미 정해져 있다**.
 * 통과점을 눈대중으로 찍게 하면 사이즈를 바꿀 때마다 곡선 성격이 달라지고,
 * 이미지에서 뽑을 때는 모델이 매번 다른 점을 찍어 재현이 안 된다.
 *
 * 아래 둘은 `~/.claude/skills/pattern-draft-app/references/engine.js` 의
 * 검증된 `fsArmhole` · `fsNeck` 을 그대로 옮긴 것이다(Freesewing Brian 블록 방식).
 * 기존 패턴 앱들과 같은 곡선이 나와야 하므로 **수식을 임의로 다듬지 않는다.**
 * ══════════════════════════════════════════════════════════════════════ */

const _lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const _dx = (a, b) => Math.abs(b[0] - a[0]);
const _dy = (a, b) => Math.abs(b[1] - a[1]);
/** 점 p 에서 각도 a(도, 0=오른쪽 · 양수=화면상 위)로 거리 d 만큼 */
const _sh = (p, a, d) => [p[0] + d * Math.cos(a * Math.PI / 180), p[1] - d * Math.sin(a * Math.PI / 180)];

/** 두 무한직선의 교점. 평행·퇴화면 원본 스킬과 같이 첫 직선의 중점으로 물러난다 */
function _beam(p0, p1, q0, q1) {
  const x = lineIntersect(p0, p1, q0, q1);
  return typeof x === 'string' ? _lerp(p0, p1, 0.5) : x;
}

/**
 * 암홀(진동) 곡선 — 어깨끝 → 품점 → 오목점(hollow) → 겨드랑.
 *
 * @param shoulder 어깨끝점 [x,y]
 * @param neck     옆목점 [x,y] — 어깨선 **방향**을 잡는 데만 쓴다(곡선이 지나지 않는다)
 * @param pitchX   앞품/뒤품점의 **x 좌표만**. 높이는 어깨~겨드랑의 중간으로 제도법이 정한다
 * @param bottom   겨드랑점 [x,y]
 * @returns {{segs, pitch, hollow}} pitch·hollow 는 너치를 걸 수 있는 실제 제도점
 *
 * 앞판은 겨드랑이 품점보다 **왼쪽**에 온다. 원본 스킬은 전역 CF 로 좌우반전해 처리했지만,
 * 여기서는 전역을 두지 않고 입력에서 좌우를 알아낸다 — 셈이 전부 평행이동 불변이라
 * 뒤집는 축을 x=0 에 둬도 결과가 같다.
 */
export function fsArmhole(shoulder, neck, pitchX, bottom) {
  const flip = bottom[0] < pitchX;
  const m = (p) => (flip ? [-p[0], p[1]] : [p[0], p[1]]);
  const SH = m(shoulder), NK = m(neck), U = m(bottom), pX = flip ? -pitchX : pitchX;

  const pitch = [pX, SH[1] + (U[1] - SH[1]) / 2];
  const corner = [pX, U[1]];                                   // 품선 × 겨드랑선 코너
  const t3 = _beam(corner, _sh(corner, 45, 10), U, pitch);     // 코너의 45° 대각 × 현(겨드랑→품점)
  const hollow = _lerp(corner, t3, 0.5);

  // 어깨끝 출발 접선은 어깨선에 수직. 품점 쪽을 향하도록 부호를 잡는다
  const dir = V.norm(V.sub(NK, SH));
  let perp = [dir[1], -dir[0]];
  if ((perp[0] * (pitch[0] - SH[0]) + perp[1] * (pitch[1] - SH[1])) < 0) perp = [-perp[0], -perp[1]];

  const shCp = V.add(SH, V.mul(perp, _dy(SH, pitch) / 5));
  const pCp2 = _sh(pitch, 90, _dy(SH, pitch) / 2);             // 품점 접선 수직
  const pCp1 = _sh(pitch, -90, _dy(pitch, hollow) / 2);
  const hCp2 = _sh(hollow, 135, _dx(pitch, hollow));           // 오목점 접선 45°
  const hCp1 = _sh(hollow, -45, _dy(hollow, U) / 2);
  const uCp2 = _sh(U, 180, _dx(corner, U) / 4);                // 겨드랑 도착 수평

  let segs = [
    { p0: SH, c1: shCp, c2: pCp2, p1: pitch },
    { p0: pitch, c1: pCp1, c2: hCp2, p1: hollow },
    { p0: hollow, c1: hCp1, c2: uCp2, p1: U },
  ];
  if (flip) segs = segs.map((g) => ({ p0: m(g.p0), c1: m(g.c1), c2: m(g.c2), p1: m(g.p1) }));
  return { segs, pitch: m(pitch), hollow: m(hollow) };
}

/**
 * 목선 — 중심 목점 → 옆목점 단일 큐빅.
 *
 * @param center      앞/뒤 중심 목점 [x,y]
 * @param snp         옆목점 [x,y]
 * @param shoulderDir 어깨선 방향벡터 (옆목점 → 어깨끝)
 *
 * SNP 쪽 핸들은 어깨선에 수직으로 뻗어 중심점의 높이(y)에 닿는 곳까지다.
 * 어깨선이 수평에 가까우면 그 교점이 무한히 멀어지므로 현 길이의 3배로 자른다 —
 * 안 그러면 이미지에서 어깨 방향을 잘못 읽었을 때 곡선이 도면 밖으로 날아가 bbox 를 망친다.
 */
export function fsNeck(center, snp, shoulderDir) {
  const dir = V.norm(shoulderDir);
  let perp = [dir[1], -dir[0]];
  if ((perp[0] * (center[0] - snp[0]) + perp[1] * (center[1] - snp[1])) < 0) perp = [-perp[0], -perp[1]];

  const chord = V.dist(center, snp);
  let cpSnp;
  if (Math.abs(perp[1]) > 1e-6) {
    const t = Math.max(-3 * chord, Math.min(3 * chord, (center[1] - snp[1]) / perp[1]));
    cpSnp = [snp[0] + perp[0] * t, snp[1] + perp[1] * t];
  } else {
    cpSnp = [snp[0] + perp[0] * _dx(snp, center) * 0.55, snp[1]];
  }
  const cpCenter = [center[0] + (snp[0] - center[0]) * 0.45, center[1]];
  return [{ p0: center, c1: cpCenter, c2: cpSnp, p1: snp }];
}

/* ── 소매산 (반소매 원형 — 교재 「반소매 원형」 제도1·제도2) ────────────
 *
 * ★ 폭을 곡선 길이로 역산하지 않는다. 교재는 **대각선(현)을 자로 재서** 폭을 정한다.
 *
 *   소매산 높이  SC = AH/4 + 2
 *   앞 대각선    = 앞AH − (0~1)
 *   뒤 대각선    = 뒤AH − (0~1)
 *
 * 정점에서 그 길이만큼 대각선을 그어 소매통선(y=SC)과 만나는 곳이 겨드랑 코너다.
 * 이세는 **결과로 나온다** — 곡선이 현보다 길어진 만큼이 이세이고, 빼는 0~1 로 조절한다.
 * (앞 구현은 곡선 길이 = AH+이세 가 되도록 이분탐색했다. 다른 교재 방식이라 갈아끼웠다.)
 *
 * 곡선 제도점 (도해 표기 그대로)
 *   정점에서 대각선 따라 AH/8 → 현 **위로** 볼록 (앞 1.8 · 뒤 1.9)
 *   겨드랑에서 앞 AH/8 · 뒤 AH/12+0.6 → 현 **아래로** 오목 (= 합인 너치)
 */

/** 소매산 한 쪽. 정점은 원점, 코너는 (cornerX, SC) */
function _capHalf(cornerX, SC, risePos, rise, ntPos, hollow) {
  const apex = [0, 0], corner = [cornerX, SC];
  const ch = V.sub(corner, apex), L = Math.hypot(ch[0], ch[1]) || 1;
  let perp = [ch[1] / L, -ch[0] / L];
  if (perp[0] * cornerX < 0) perp = [-perp[0], -perp[1]];   // 바깥쪽(볼록 방향)으로 맞춘다
  const along = (f) => [ch[0] * f, ch[1] * f];
  const f1 = Math.min(risePos / L, 0.45);        // 정점에서 AH/8
  const f2 = Math.max(1 - ntPos / L, 0.55);      // 겨드랑에서 AH/8 (뒤는 AH/12+0.6)
  const up = V.add(along(f1), V.mul(perp, rise));        // 현 위로 볼록
  const dn = V.sub(along(f2), V.mul(perp, hollow));      // 현 아래로 오목 = 합인
  /* 정점 출발 접선을 수평으로 준다 — 앞뒤가 정점에서 일직선으로 만나 꼭대기가 꺾이지 않는다 */
  return { seg: through([apex, up, dn, corner], [cornerX > 0 ? 1 : -1, 0], null, 0.42), notch: dn, chord: L };
}

/**
 * 반소매 원형 소매산.
 *
 * @param frontAH 앞 암홀 길이 (몸판 실측)
 * @param backAH  뒤 암홀 길이
 * @param o.capHeight   소매산 높이. 0 이면 자동 AH/4+2
 * @param o.frontReduce 앞 대각선에서 뺄 값 (도해 0~1)
 * @param o.backReduce  뒤 대각선에서 뺄 값 (도해 0~1)
 * @param o.frontRise   앞 AH/8 지점 볼록량 (도해 1.8)
 * @param o.backRise    뒤 AH/8 지점 볼록량 (도해 1.9)
 * @returns 정점이 원점인 국소좌표. ease 는 **결과**다
 */
export function bunkaSleeveCap(frontAH, backAH, o) {
  const AH = frontAH + backAH;
  if (!(AH > 0)) throw new Error(`소매산: 암홀 길이가 0 이하다 (앞 ${frontAH}, 뒤 ${backAH})`);
  const SC = o.capHeight > 0 ? o.capHeight : AH / 4 + 2;
  if (!(SC > 0)) throw new Error(`소매산 높이가 0 이하다 (${SC})`);

  const fCh = frontAH - o.frontReduce, bCh = backAH - o.backReduce;
  /* 대각선이 소매산 높이보다 짧으면 소매통선에 닿지 못한다 — 삼각형이 성립하지 않는다.
   * 산을 너무 높게 잡았거나 빼는 값이 과한 경우다. 조용히 NaN 을 내보내지 않는다. */
  for (const [쪽, ch] of [['앞', fCh], ['뒤', bCh]]) {
    if (!(ch > SC)) {
      throw new Error(`${쪽} 대각선 ${ch.toFixed(2)}cm 가 소매산 높이 ${SC.toFixed(2)}cm 보다 짧다`
        + ` — 산을 낮추거나 빼는 값을 줄여라 (AH/4+2 = ${(AH / 4 + 2).toFixed(2)})`);
    }
  }
  const fx = Math.sqrt(fCh * fCh - SC * SC), bx = -Math.sqrt(bCh * bCh - SC * SC);

  const risePos = AH / 8;                                  // 정점에서 AH/8
  const fNt = AH / 8, bNt = AH / 12 + 0.6;                 // 겨드랑에서 (도해 표기)
  /* 오목 깊이는 도해에 수치가 없다. 현 길이 비례로 둔다 — 절대 cm 로 두면 사이즈가 작아질 때
   * 과하게 파인다. 앞이 뒤보다 깊은 것은 교재 곡선의 성격이다. */
  const F = _capHalf(fx, SC, risePos, o.frontRise, fNt, 0.055 * fCh);
  const B = _capHalf(bx, SC, risePos, o.backRise, bNt, 0.030 * bCh);

  const lenF = segsLen(F.seg), lenB = segsLen(B.seg);
  return {
    front: F.seg, back: B.seg,
    fc: F.seg[F.seg.length - 1].p1, bc: B.seg[B.seg.length - 1].p1,
    notchF: F.notch, notchB: B.notch,
    SC, chordF: F.chord, chordB: B.chord,
    capLen: lenF + lenB, lenF, lenB, ease: lenF + lenB - AH, AH,
  };
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
