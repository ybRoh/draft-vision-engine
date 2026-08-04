/* 제도식 평가기 — "B/12+2.5" 같은 교재 계산식을 그대로 좌표로 쓴다.
 *
 * eval() 을 쓰지 않는다. 식의 출처가 VLM(모델이 이미지를 보고 쓴 문자열)이라
 * 임의 코드가 섞여 들어올 수 있다. 토크나이저 → Pratt 파서 → 순수 계산만 한다.
 *
 * 같은 이유로 이름표는 전부 **프로토타입 없는 객체**다. 평범한 객체 리터럴이면
 * `constructor` · `toString` 같은 이름이 `in` 검사를 통과해 함수가 좌표로 흘러든다.
 * 그러면 오류 하나 없이 x 가 false 인 점이 든 도면이 만들어진다.
 *
 * 삼각함수는 **도(degree)** 를 받는다. 제도 교재가 "어깨경사 22°" 로 쓰기 때문이다.
 * 라디안이 필요하면 rad()/deg() 로 명시적으로 변환한다.
 */

const RE_NUM = /^(?:\d+(?:\.\d+)?|\.\d+)/;
const RE_ID = /^[A-Za-z_가-힣][A-Za-z_0-9가-힣]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*/;

const D2R = Math.PI / 180;
const nul = (o) => Object.assign(Object.create(null), o);

/** 이름 → [인자 수(-1 이면 가변), 함수]. 인자 수를 안 재면 round(x,1) 이 조용히 틀린 값을 낸다 */
const FN = nul({
  sqrt: [1, Math.sqrt], abs: [1, Math.abs], round: [1, Math.round],
  floor: [1, Math.floor], ceil: [1, Math.ceil],
  min: [-1, Math.min], max: [-1, Math.max], hypot: [-1, Math.hypot],
  sin: [1, (d) => Math.sin(d * D2R)], cos: [1, (d) => Math.cos(d * D2R)], tan: [1, (d) => Math.tan(d * D2R)],
  asin: [1, (v) => Math.asin(v) / D2R], acos: [1, (v) => Math.acos(v) / D2R], atan: [1, (v) => Math.atan(v) / D2R],
  atan2: [2, (y, x) => Math.atan2(y, x) / D2R],
  rad: [1, (d) => d * D2R], deg: [1, (r) => r / D2R],
});
/** 문서·검증용 이름 목록 */
export const FUNCS = nul(Object.fromEntries(Object.keys(FN).map((k) => [k, FN[k][1]])));
const CONSTS = nul({ PI: Math.PI, E: Math.E });

/* 교재를 읽은 모델은 곱셈에 ×, 뺄셈에 유니코드 −, 전각 괄호를 그대로 써 온다.
 * 여기서 흡수하지 않으면 "알 수 없는 문자" 로 튕겨 나가 사람이 손으로 고쳐야 한다. */
const NORM = nul({
  '×': '*', '·': '*', '∙': '*', '＊': '*',
  '÷': '/', '／': '/',
  '−': '-', '–': '-', '—': '-', '－': '-',
  '＋': '+', '（': '(', '）': ')', '　': ' ',
});
const normalize = (s) => String(s).replace(/[×·∙＊÷／−–—－＋（）　]/g, (c) => NORM[c]);

const MAX_TOKENS = 2000;   // 신뢰 못 할 입력이 파서 재귀로 스택을 터뜨리지 못하게
const MAX_DEPTH = 100;

export class ExprError extends Error {
  constructor(msg, src, pos) {
    super(`${msg}  ← "${src}"${pos != null ? ` (${pos + 1}번째 글자)` : ''}`);
    this.name = 'ExprError';
    this.src = src;
  }
}

/** 문자열 → 토큰 배열 */
function lex(src) {
  const out = [];
  const s = src;
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    let m;
    if ((m = RE_NUM.exec(rest))) { out.push({ t: 'num', v: +m[0], i }); i += m[0].length; }
    else if ((m = RE_ID.exec(rest))) { out.push({ t: 'id', v: m[0], i }); i += m[0].length; }
    else if ('+-*/%^(),'.includes(rest[0])) { out.push({ t: rest[0], i }); i++; }
    else throw new ExprError(`알 수 없는 문자 '${rest[0]}'`, src, i);
    if (out.length > MAX_TOKENS) throw new ExprError(`식이 너무 길다 (토큰 ${MAX_TOKENS}개 넘음)`, src, i);
  }
  out.push({ t: 'end', i: s.length });
  return out;
}

/* 우선순위. ^ 는 여기 없다 — 단항 마이너스보다 강하게 묶여야 해서 따로 처리한다
 * (-2^2 는 4 가 아니라 -4 다). */
const BIN = nul({ '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 });

/** 토큰 → AST */
function parse(rawSrc) {
  const src = normalize(rawSrc);
  const tk = lex(src);
  let p = 0, depth = 0;
  const peek = () => tk[p];
  const take = (t) => {
    if (tk[p].t !== t) throw new ExprError(`'${t}' 가 필요한데 '${tk[p].t}' 가 왔다`, src, tk[p].i);
    return tk[p++];
  };
  const deeper = (f) => {
    if (++depth > MAX_DEPTH) throw new ExprError(`괄호가 너무 깊다 (${MAX_DEPTH}겹 넘음)`, src, tk[p].i);
    try { return f(); } finally { depth--; }
  };

  function atom() {
    const t = peek();
    if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
    if (t.t === '(') { p++; const e = deeper(() => expr(0)); take(')'); return e; }
    if (t.t === 'id') {
      p++;
      if (peek().t === '(') {
        p++;
        const args = [];
        if (peek().t !== ')') { args.push(deeper(() => expr(0))); while (peek().t === ',') { p++; args.push(deeper(() => expr(0))); } }
        take(')');
        return { k: 'call', name: t.v, args, pos: t.i };
      }
      return { k: 'ref', name: t.v };
    }
    throw new ExprError(`식이 끊겼다 ('${t.t}')`, src, t.i);
  }

  /** 거듭제곱 — 우결합이고 지수 쪽에 단항 마이너스를 허용한다 (2^-1) */
  function power() {
    const base = atom();
    if (peek().t === '^') { p++; return { k: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function unary() {
    if (peek().t === '-') { p++; return { k: 'neg', a: unary() }; }
    if (peek().t === '+') { p++; return unary(); }
    return power();
  }

  function expr(minPrec) {
    let left = unary();
    for (;;) {
      const op = peek().t;
      const prec = BIN[op];
      if (prec == null || prec < minPrec) break;
      p++;
      left = { k: 'bin', op, a: left, b: expr(prec + 1) };
    }
    return left;
  }

  const e = expr(0);
  if (peek().t !== 'end') {
    const t = peek();
    // "1/3B" 처럼 곱셈 기호를 빠뜨린 게 가장 흔하다 — 원인을 짚어준다
    const hint = (t.t === 'id' || t.t === 'num') ? ' (곱셈 기호 * 가 빠진 것 같다)' : '';
    throw new ExprError(`식 뒤에 군더더기가 남았다${hint}`, src, t.i);
  }
  return e;
}

const astCache = new Map();
const AST_CACHE_MAX = 5000;
function ast(src) {
  let a = astCache.get(src);
  if (!a) {
    a = parse(src);
    if (astCache.size >= AST_CACHE_MAX) astCache.clear();   // 장시간 구동 시 무한 증식 방지
    astCache.set(src, a);
  }
  return a;
}

/** scope 에서 "SNP.x" 같은 점 경로를 읽는다 */
function lookup(name, scope, src) {
  if (name in CONSTS) return CONSTS[name];
  const parts = name.split('.');
  let cur = scope;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object' || !Object.hasOwn(cur, parts[i])) {
      throw new ExprError(`'${name}' 을 모른다 (${parts.slice(0, i + 1).join('.')} 없음)`, src);
    }
    cur = cur[parts[i]];
  }
  if (typeof cur !== 'number' || !Number.isFinite(cur)) {
    throw new ExprError(`'${name}' 이 숫자가 아니다 (${typeof cur === 'number' ? cur : typeof cur})`, src);
  }
  return cur;
}

const finite = (v, what, src) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ExprError(`${what} 의 결과가 숫자가 아니다 (${typeof v === 'number' ? v : typeof v})`, src);
  }
  return v;
};

function run(node, scope, src) {
  switch (node.k) {
    case 'num': return node.v;
    case 'neg': return -run(node.a, scope, src);
    case 'ref': return lookup(node.name, scope, src);
    case 'call': {
      const def = Object.hasOwn(FN, node.name) ? FN[node.name] : null;
      if (!def) throw new ExprError(`함수 '${node.name}' 은 없다 (쓸 수 있는 것: ${Object.keys(FN).join(', ')})`, src, node.pos);
      const [arity, f] = def;
      if (arity === -1 ? node.args.length < 1 : node.args.length !== arity) {
        throw new ExprError(`함수 '${node.name}' 은 인자 ${arity === -1 ? '1개 이상' : `${arity}개`} 인데 ${node.args.length}개를 줬다`, src, node.pos);
      }
      return finite(f(...node.args.map((a) => run(a, scope, src))), `${node.name}()`, src);
    }
    case 'bin': {
      const a = run(node.a, scope, src), b = run(node.b, scope, src);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return finite(a * b, '곱셈', src);
        case '/':
          if (b === 0) throw new ExprError('0 으로 나눴다', src);
          return a / b;
        case '%':
          if (b === 0) throw new ExprError('0 으로 나눈 나머지를 구했다', src);
          return a % b;
        case '^': return finite(a ** b, '거듭제곱', src);
      }
    }
  }
  throw new ExprError(`알 수 없는 노드 ${node.k}`, src);
}

/**
 * 식을 계산한다. 숫자를 넣으면 그대로 돌려준다 (DSL 이 숫자/문자열을 섞어 쓰므로).
 * @param {string|number} src
 * @param {object} scope  measures + params + 이미 풀린 점들
 */
export function evalExpr(src, scope) {
  if (typeof src === 'number') {
    if (!Number.isFinite(src)) throw new ExprError(`숫자가 아니다 (${src})`, String(src));
    return src;
  }
  if (src == null || String(src).trim() === '') throw new ExprError('빈 식', String(src));
  return run(ast(String(src)), scope, normalize(src));
}

/**
 * 식이 참조하는 이름들 (점 이름은 첫 마디만 — "SNP.x" → "SNP").
 *
 * 겸해서 **함수 이름과 인자 수를 정적으로 검사**한다. 값을 계산해 봐야 알 수 있는 것
 * (0 나눗셈 등)과 달리 이건 식만 봐도 알 수 있고, 여기서 잡아야 검사기가
 * `process.exit(1)` 이나 `round(B/4, 1)` 같은 식을 걸러낼 수 있다.
 */
export function deps(src) {
  if (typeof src === 'number') {
    if (!Number.isFinite(src)) throw new ExprError(`숫자가 아니다 (${src})`, String(src));
    return [];
  }
  if (src == null || String(src).trim() === '') throw new ExprError('빈 식', String(src));
  const s = normalize(src);
  const out = new Set();
  (function walk(n) {
    if (n.k === 'ref' && !(n.name in CONSTS)) out.add(n.name.split('.')[0]);
    if (n.k === 'call') {
      const def = Object.hasOwn(FN, n.name) ? FN[n.name] : null;
      if (!def) throw new ExprError(`함수 '${n.name}' 은 없다 (쓸 수 있는 것: ${Object.keys(FN).join(', ')})`, s, n.pos);
      const arity = def[0];
      if (arity === -1 ? n.args.length < 1 : n.args.length !== arity) {
        throw new ExprError(`함수 '${n.name}' 은 인자 ${arity === -1 ? '1개 이상' : `${arity}개`} 인데 ${n.args.length}개를 줬다`, s, n.pos);
      }
      n.args.forEach(walk);
    }
    if (n.k === 'bin') { walk(n.a); walk(n.b); }
    if (n.k === 'neg') walk(n.a);
  })(ast(String(src)));
  return [...out];
}
