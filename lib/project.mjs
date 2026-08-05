/* 조각 여러 개를 한 벌로 푼다 — 소매가 몸판 암홀 길이를 받아야 그려지기 때문이다.
 *
 * lib/draft.mjs 의 resolve() 는 파일을 모른다(순수 함수로 둔다). 파일을 읽고 참조 그래프를
 * 푸는 일은 전부 여기서 한다. node 기본 모듈만 쓴다 — npm 의존성은 여전히 0.
 *
 * 세 단계로 나눈 이유가 있다.
 *   1) 읽기   — 참조를 따라 모든 파일을 읽는다(고리 검출)
 *   2) 검사   — 덮어쓸 이름이 **그래프 어딘가에는** 있는지 본다
 *   3) 풀기   — 의존 순서대로 resolve
 * 한 번에 하면 `--set B=98` 을 소매에 걸었을 때 "소매에는 B 가 없다" 로 죽거나, 반대로
 * 오타를 조용히 삼킨다. 소매는 B 를 모르지만 몸판을 거쳐 B 의 영향을 받는 게 정상이다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validate } from './validate.mjs';
import { resolve as resolveDraft, DraftError } from './draft.mjs';

const 짧게 = (p) => path.relative(process.cwd(), p) || p;

/** 참조를 따라 전부 읽는다. @returns Map<절대경로, spec> */
function readAll(abs, stack, specs) {
  /* 고리 검사가 **메모보다 먼저**여야 한다. 순서를 바꾸면 이미 읽은 파일로 되돌아오는
   * 뒤엣변(back edge)이 그냥 통과해 버려, 고리를 못 잡고 나중에 스택오버플로로 죽는다. */
  const i = stack.indexOf(abs);
  if (i >= 0) {
    const 고리 = [...stack.slice(i), abs].map(짧게).join('\n     → ');
    throw new DraftError(`조각 참조가 고리를 이룬다:\n     ${고리}`);
  }
  if (specs.has(abs)) return specs;
  let spec;
  try { spec = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { throw new DraftError(`'${짧게(abs)}' 를 읽지 못했다 — ${e.message}`); }

  const errs = validate(spec);
  if (errs.length) throw new DraftError(`'${짧게(abs)}' 가 검사를 통과 못한다:\n  ${errs.join('\n  ')}`);

  specs.set(abs, spec);
  for (const r of spec.refs) {
    readAll(path.resolve(path.dirname(abs), r.draft), [...stack, abs], specs);
  }
  // 원형비교패턴도 실제로 풀어야 하므로 같이 읽는다 (고리 검사도 같이 걸린다)
  for (const c of spec.compare ?? []) {
    readAll(path.resolve(path.dirname(abs), c.draft), [...stack, abs], specs);
  }
  return specs;
}

/** 다 푼 도면에서 참조가 원하는 값 하나를 꺼낸다 */
function 꺼내기(d, r, 어디) {
  if (r.take === 'segmentLength') {
    const seg = d.segments.find((s) => s.id === r.of);
    if (!seg) throw new DraftError(`${어디}: 참조 '${r.id}' 가 가리키는 선 '${r.of}' 이 '${r.draft}' 에 없다`);
    return seg.length;
  }
  const p = d.points[r.of];
  if (!p) throw new DraftError(`${어디}: 참조 '${r.id}' 가 가리키는 점 '${r.of}' 이 '${r.draft}' 에 없다`);
  return r.take === 'pointX' ? p.x : p.y;
}

/**
 * draft.json 하나를 그 참조까지 따라가며 푼다.
 *
 * @param file      draft.json 경로
 * @param overrides 치수 덮어쓰기. **그래프 전체에 전파된다** — `--set B=98` 이면 몸판 암홀이
 *                  커지고, 소매산은 그 암홀에 맞춰 다시 역산된다
 * @returns {{drawing, specs: Map, deps: string[]}} drawing 은 resolve() 결과와 같다
 */
export function loadDraft(file, overrides = {}) {
  const abs = path.resolve(file);
  const specs = readAll(abs, [], new Map());

  // ── 덮어쓸 이름이 그래프 어딘가에는 있어야 한다 (오타를 조용히 삼키지 않는다)
  const 아는이름 = new Set(), 참조이름 = new Set();
  for (const spec of specs.values()) {
    for (const o of [...spec.measures, ...spec.params]) 아는이름.add(o.id);
    for (const r of spec.refs) 참조이름.add(r.id);
  }
  for (const k of Object.keys(overrides)) {
    if (아는이름.has(k)) continue;
    /* 참조 이름을 덮어쓰려 한 경우는 따로 짚어 준다 — "그런 이름 없다" 보다
     * "그건 다른 조각에서 실측해 오는 값이다" 가 실제로 할 일을 알려준다. */
    if (참조이름.has(k)) {
      throw new DraftError(`'${k}' 는 다른 조각에서 실측해 오는 참조라 덮어쓸 수 없다`
        + ` — 원본 조각의 치수를 바꾸면 따라온다`);
    }
    throw new DraftError(`덮어쓸 '${k}' 가 어느 조각의 measures/params 에도 없다`
      + ` (아는 이름: ${[...아는이름].sort().join(', ')})`);
  }

  // ── 의존 순서대로 푼다 (참조가 깊어져도 후위순회 한 번이면 된다)
  const 결과 = new Map();
  const 푸는중 = new Set();
  const 풀기 = (a) => {
    if (결과.has(a)) return 결과.get(a);
    // readAll 이 고리를 이미 걸렀지만, 놓치면 여기서 스택오버플로가 난다 — 안전망을 둔다
    if (푸는중.has(a)) throw new DraftError(`조각 참조가 고리를 이룬다: ${짧게(a)}`);
    푸는중.add(a);
    const spec = specs.get(a);
    const refValues = Object.create(null);
    for (const r of spec.refs) {
      const target = path.resolve(path.dirname(a), r.draft);
      refValues[r.id] = 꺼내기(풀기(target), r, 짧게(a));
    }
    /* 이 조각이 아는 이름만 걸러 넘긴다. 소매는 B 를 모르지만 몸판을 거쳐 영향을 받는다 —
     * 위에서 그래프 전체로 이름을 확인했으니 여기서 거르는 건 안전하다. */
    const 내것 = Object.create(null);
    for (const o of [...spec.measures, ...spec.params]) {
      if (Object.prototype.hasOwnProperty.call(overrides, o.id)) 내것[o.id] = overrides[o.id];
    }
    /* 비교패턴은 그 원형을 **같은 덮어쓰기로** 풀어서 완성선만 가져온다.
     * 사이즈를 바꾸면 원형도 같이 커져야 비교가 성립한다. */
    const compareGeom = Object.create(null);
    for (const c of spec.compare ?? []) {
      const target = path.resolve(path.dirname(a), c.draft);
      const cd = 풀기(target);
      compareGeom[c.id] = {
        name: cd.name,
        lines: cd.segments.filter((sg) => sg.layer === 'cut' || sg.layer === 'fold').map((sg) => sg.pts),
      };
      if (!compareGeom[c.id].lines.length) {
        throw new DraftError(`비교패턴 '${c.id}': '${c.draft}' 에 완성선(cut/fold)이 하나도 없다`);
      }
    }
    let d;
    try { d = resolveDraft(spec, 내것, refValues, compareGeom); }
    catch (e) {
      if (e instanceof DraftError) throw new DraftError(`'${짧게(a)}' — ${e.message}`);
      throw e;
    }
    결과.set(a, d); 푸는중.delete(a);
    return d;
  };

  return { drawing: 풀기(abs), specs, deps: [...specs.keys()].filter((k) => k !== abs) };
}
