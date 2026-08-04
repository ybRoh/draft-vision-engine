/* DSL 검사 — 구조(스키마) + 의미(참조 무결성 + 계산식).
 * 의존성 0. 스키마는 lib/schema.mjs 의 DRAFT_SCHEMA 를 직접 걸어 본다.
 *
 * 계산식 검사가 여기 있는 게 중요하다. 모델이 가장 자주 틀리는 게 식인데,
 * 검사기가 식을 안 보면 tools/extract.mjs 의 "고쳐 달라" 재시도가 아예 안 돈다 —
 * API 를 한 번 다 쓰고 나서 resolve 단계에서 스택트레이스로 죽는다.
 */

import { DRAFT_SCHEMA, LAYER_LIST } from './schema.mjs';
import { deps, ExprError } from './expr.mjs';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 아주 작은 JSON Schema 검사기 — DRAFT_SCHEMA 가 쓰는 문법만 다룬다 */
function checkSchema(node, schema, path, errs) {
  if (schema.const !== undefined) {
    if (node !== schema.const) errs.push(`${path}: '${schema.const}' 이어야 하는데 ${JSON.stringify(node)}`);
    return;
  }
  if (schema.enum) {
    if (!schema.enum.includes(node)) errs.push(`${path}: ${schema.enum.join('|')} 중 하나여야 하는데 ${JSON.stringify(node)}`);
    return;
  }
  if (schema.anyOf) {
    const tries = schema.anyOf.map((s) => { const e = []; checkSchema(node, s, path, e); return e; });
    if (tries.every((e) => e.length)) {
      /* 가장 적게 틀린 분기의 오류를 보여준다 (kind 로 갈리므로 대개 정확히 맞아떨어진다).
       * 동률이면 어느 쪽을 의도했는지 알 수 없으니 후보를 다 보여준다 — 한쪽만 보이면
       * "string 이어야 하는데 array" 같은 엉뚱한 지적이 된다. */
      const min = Math.min(...tries.map((e) => e.length));
      const best = tries.filter((e) => e.length === min);
      if (best.length === 1) errs.push(...best[0]);
      else errs.push(`${path}: 어느 형태에도 안 맞는다 — ${best.map((e) => e.join(' / ')).join('  |  ')}`);
    }
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = Array.isArray(node) ? 'array' : node === null ? 'null' : typeof node;
  if (schema.type && !types.includes(actual)) {
    errs.push(`${path}: ${types.join('|')} 이어야 하는데 ${actual}`);
    return;
  }
  if (actual === 'number' && !Number.isFinite(node)) errs.push(`${path}: 숫자가 아니다 (${node})`);
  if (schema.type === 'array') {
    node.forEach((v, i) => checkSchema(v, schema.items, `${path}[${i}]`, errs));
  }
  if (schema.type === 'object') {
    // `in` 은 프로토타입 체인을 본다 — 'toString' 같은 키가 조용히 통과한다. hasOwn 으로 봐야 한다
    for (const k of schema.required ?? []) {
      if (!hasOwn(node, k)) errs.push(`${path}.${k}: 빠졌다`);
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(node)) {
        if (!hasOwn(schema.properties, k)) errs.push(`${path}.${k}: 모르는 항목 (허용: ${Object.keys(schema.properties).join(', ')})`);
      }
    }
    for (const [k, s] of Object.entries(schema.properties ?? {})) {
      if (hasOwn(node, k)) checkSchema(node[k], s, `${path}.${k}`, errs);
    }
  }
}

const ID_RE = /^[A-Za-z_][A-Za-z_0-9]*$/;

/** 점 kind 별로 식이 들어 있는 칸 */
const EXPR_FIELDS = {
  xy: ['x', 'y'], offset: ['dx', 'dy'], polar: ['angle', 'dist'], on: ['t'], intersect: [],
};

/**
 * @returns {string[]} 오류 목록 (빈 배열이면 통과)
 */
export function validate(spec) {
  const errs = [];
  if (!spec || typeof spec !== 'object') return ['최상위가 객체가 아니다'];
  checkSchema(spec, DRAFT_SCHEMA, 'draft', errs);
  if (errs.length) return errs;   // 구조가 깨졌으면 의미 검사는 무의미

  // ── 빈 도면
  if (!spec.points.length) errs.push('points: 점이 하나도 없다');
  if (!spec.segments.length) errs.push('segments: 선이 하나도 없다');

  // ── 이름 규칙 · 중복
  //  measures/params/points 는 식에서 같은 이름공간을 쓰므로 한 통에 넣고 검사한다.
  //  segments/darts/notches 는 도구들이 키로 쓰므로 자기들끼리만 안 겹치면 된다.
  const seen = new Map();
  const claim = (id, where, bag) => {
    if (!ID_RE.test(id)) errs.push(`${where}: id '${id}' 는 식에서 못 쓴다 (영문으로 시작, 영문·숫자·밑줄만)`);
    if (bag.has(id)) errs.push(`${where}: id '${id}' 가 ${bag.get(id)} 와 겹친다`);
    else bag.set(id, where);
  };
  spec.measures.forEach((m, i) => claim(m.id, `measures[${i}]`, seen));
  spec.params.forEach((p, i) => claim(p.id, `params[${i}]`, seen));
  spec.points.forEach((p, i) => claim(p.id, `points[${i}]`, seen));
  const bagS = new Map(); spec.segments.forEach((s, i) => claim(s.id, `segments[${i}]`, bagS));
  const bagD = new Map(); spec.darts.forEach((d, i) => claim(d.id, `darts[${i}]`, bagD));
  const bagN = new Map(); spec.notches.forEach((n, i) => claim(n.id, `notches[${i}]`, bagN));

  // ── 참조 무결성
  const pointIds = new Set(spec.points.map((p) => p.id));
  const nameIds = new Set([...spec.measures, ...spec.params].map((o) => o.id));
  const ref = (id, where) => {
    if (!pointIds.has(id)) errs.push(`${where}: 점 '${id}' 이 points 에 없다`);
  };

  // ── 계산식: 문법이 맞는지 + 참조하는 이름이 있는지
  const checkExpr = (e, where) => {
    let names;
    try { names = deps(e); }
    catch (err) {
      if (err instanceof ExprError) { errs.push(`${where}: 식이 잘못됐다 — ${err.message}`); return; }
      throw err;
    }
    for (const n of names) {
      if (!nameIds.has(n) && !pointIds.has(n)) errs.push(`${where}: 식이 모르는 이름 '${n}' 을 쓴다`);
    }
  };

  spec.points.forEach((p, i) => {
    const w = `points[${i}](${p.id})`;
    if (p.kind === 'offset' || p.kind === 'polar') ref(p.from, w);
    if (p.kind === 'on') { ref(p.a, w); ref(p.b, w); }
    if (p.kind === 'intersect') { ref(p.a1, w); ref(p.a2, w); ref(p.b1, w); ref(p.b2, w); }
    for (const f of EXPR_FIELDS[p.kind] ?? []) checkExpr(p[f], `${w}.${f}`);
  });

  /* 선 kind 별로 점 id 가 들어 있는 칸. 새 kind 를 만들면 여기에 반드시 등록한다 —
   * 빠뜨리면 그 kind 의 점 참조가 검사를 통째로 빠져나가 resolve 에서 죽는다. */
  const SEG_REFS = {
    line: (s) => s.pts,
    curve: (s) => s.through,
    neck: (s) => [s.center, s.snp, s.shoulder],
    armhole: (s) => [s.shoulder, s.neck, s.pitch, s.bottom],
  };

  spec.segments.forEach((s, i) => {
    const w = `segments[${i}](${s.id})`;
    const list = SEG_REFS[s.kind]?.(s) ?? [];
    list.forEach((id) => ref(id, w));
    if (!LAYER_LIST.includes(s.layer)) errs.push(`${w}: layer '${s.layer}' 는 없다`);

    if (s.kind === 'line' || s.kind === 'curve') {
      if (list.length < 2) errs.push(`${w}: 점이 ${list.length}개뿐이다 (2개 이상)`);
      for (let j = 1; j < list.length; j++) {
        if (list[j] === list[j - 1]) errs.push(`${w}: '${list[j]}' 이 연달아 두 번 나온다 (길이 0 구간)`);
      }
      // tension 은 스키마로 범위를 못 건다(structured output 이 maximum 을 못 쓴다) — 여기서 막는다
      if (s.kind === 'curve' && !(s.tension >= 0 && s.tension <= 2)) {
        errs.push(`${w}: tension ${s.tension} 은 범위 밖이다 (0~2, 보통 0.35~0.6)`);
      }
    }

    /* 제도법 곡선은 각 칸이 **서로 다른 점**이어야 한다.
     * 같은 점을 두 칸에 넣으면 방향벡터가 0 이 되어 곡선이 조용히 뭉개진다. */
    if (s.kind === 'neck') {
      if (s.center === s.snp) errs.push(`${w}: center 와 snp 가 같은 점이다`);
      if (s.snp === s.shoulder) errs.push(`${w}: snp 와 shoulder 가 같으면 어깨선 방향을 못 잡는다`);
    }
    if (s.kind === 'armhole') {
      if (s.shoulder === s.bottom) errs.push(`${w}: shoulder 와 bottom 이 같은 점이다`);
      if (s.shoulder === s.neck) errs.push(`${w}: shoulder 와 neck 이 같으면 어깨선 방향을 못 잡는다`);
    }
  });

  spec.darts.forEach((d, i) => {
    const w = `darts[${i}](${d.id})`;
    ref(d.apex, w); ref(d.leg1, w); ref(d.leg2, w);
  });
  spec.notches.forEach((n, i) => ref(n.at, `notches[${i}](${n.id})`));

  return errs;
}
