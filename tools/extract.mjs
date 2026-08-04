#!/usr/bin/env node
/* 2단계 — 교재 제도 도면 이미지 → 제도 DSL.
 *
 * 핵심은 "그림을 그려줘" 가 아니라 **"제도 절차를 받아써줘"** 를 시키는 것이다.
 * 좌표를 뽑으면 그 사이즈에서만 맞는 죽은 도면이 되고, 계산식을 뽑으면 그레이딩이 공짜로 따라온다.
 * 그래서 스키마(lib/schema.mjs)로 x/y 를 **식 문자열**로 강제하고,
 * structured output 으로 모델이 그 모양을 벗어날 수 없게 만든다.
 *
 *   node tools/extract.mjs 교재_128쪽.png --name p128
 *   node tools/extract.mjs 앞판.jpg 뒤판.jpg --name blouse --hint "문화식 블라우스 원형, B=86"
 *
 * 인증: ANTHROPIC_API_KEY 를 export 하거나 `ant auth login` 으로 프로필을 잡아두면 된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { DRAFT_SCHEMA } from '../lib/schema.mjs';
import { validate } from '../lib/validate.mjs';
import { resolve } from '../lib/draft.mjs';

const MODEL = 'claude-opus-5';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** 요청 한 번의 크기 한도. base64 로 부풀린 이미지 합계가 여기 가까우면 미리 알려준다 */
const REQ_LIMIT = 32 * 1024 * 1024;

const USAGE = '사용법: node tools/extract.mjs <이미지...> [--name 이름] [--hint "설명"] [--effort low|medium|high|xhigh|max]';

/* 플래그가 값을 받는지 적어 둔 표. 값을 받는 플래그 뒤 토큰만 건너뛴다.
 * "앞 토큰이 --로 시작하면 버린다" 로 걸러 내면 값 없는 플래그 뒤의 파일 이름까지 같이 사라진다. */
const ARITY = { name: 1, hint: 1, effort: 1 };

/** 쓰는 사람이 잘못 쓴 경우 — 사용법 문제이므로 2 */
function die2(msg) { console.error(`✖ ${msg}`); process.exit(2); }

/** 인자를 플래그와 나머지(이미지 이름)로 가른다. `--이름 값` 과 `--이름=값` 을 둘 다 받는다. */
function parseArgs(argv, arity) {
  const opts = Object.create(null);   // 이름 → 값 배열 (값 없는 플래그는 true)
  const rest = [];
  const known = Object.keys(arity).map((n) => `--${n}`).join(', ');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { rest.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (!Object.hasOwn(arity, name)) die2(`모르는 플래그 '--${name}' (쓸 수 있는 것: ${known})`);
    let v;
    if (arity[name] === 0) {
      if (eq >= 0) die2(`'--${name}' 은 값을 받지 않는다`);
      v = true;
    } else if (eq >= 0) {
      v = a.slice(eq + 1);
    } else {
      v = argv[++i];
      if (v === undefined) die2(`'--${name}' 에 값이 없다`);
    }
    (opts[name] ??= []).push(v);
  }
  return { opts, rest };
}

const { opts, rest: images } = parseArgs(process.argv.slice(2), ARITY);
const opt = (n) => (opts[n] ? opts[n][opts[n].length - 1] : undefined);   // 여러 번 주면 마지막 것

// 잘못된 effort 는 여기서 막는다. 안 그러면 이미지를 다 올리고 나서 400 을 받는다.
// 이미지 개수보다 먼저 보는 이유: `--effort 앞판.png` 처럼 값을 빠뜨리면 파일 이름이 값으로 먹히는데,
// 그때 "이미지가 없다" 보다 "effort 값이 이상하다" 가 실제 실수를 가리킨다.
const effort = opt('effort') ?? 'xhigh';
if (!EFFORTS.includes(effort)) die2(`--effort 는 ${EFFORTS.join('|')} 중 하나여야 한다: '${effort}'`);

if (!images.length) {
  console.error(USAGE);
  process.exit(2);
}

const SYSTEM = `당신은 여성복 패턴 제도 교재를 읽어 **자동 제도 엔진이 실행할 수 있는 사양(DSL)** 으로 옮기는 일을 합니다.

가장 중요한 원칙 — **좌표가 아니라 계산식을 받아쓰십시오.**
도면에서 "B/12+2.5", "등길이/3", "B/6+7" 같은 표기를 찾아 그 문자열을 그대로 x/y 식에 넣습니다.
자로 잰 듯한 숫자(예: 7.2)를 박아 넣으면 치수를 바꿨을 때 도면이 따라오지 않아 쓸모가 없습니다.
숫자를 그대로 써야 하는 자리는 여유분·경사각처럼 치수와 무관한 상수뿐이며, 그건 params 로 빼서 이름을 붙이십시오.

좌표계: x 는 오른쪽이 +, **y 는 아래가 +** 입니다. 단위는 cm.
보통 앞중심/뒤중심을 x=0 에, 어깨 수평 기준선을 y=0 에 두고 시작합니다.

점 지정 방식을 골라 쓰십시오. 교재의 제도 순서에 가장 가까운 것을 고르는 게 좋습니다.
  xy        좌표를 식으로 직접 (기준 사각형의 꼭짓점 등)
  offset    다른 점에서 dx,dy 만큼 ("A 에서 아래로 등길이")
  polar     다른 점에서 각도·거리 ("옆목점에서 22도 내려 어깨길이만큼")
  on        두 점 사이 비율 위치 ("AB 를 3등분한 점" → t: 0.3333)
  intersect 두 직선의 교점 ("어깨선과 어깨너비선이 만나는 곳")

선(segments):
  layer 는 cut(완성선·실선) / guide(안내선·점선) / fold(골선) / dart / construction(제도 보조선) 입니다.
  실선으로 굵게 그려진 완성선은 cut, 가늘거나 점선인 기초선은 guide 로 나눠 담으십시오.
  암홀·목선·옆선처럼 휘는 선은 kind: "curve" 로, 곡선이 지나는 점들을 through 에 순서대로 넣습니다.
  tension 은 곡선의 팽팽함입니다 — 암홀 0.42~0.55, 목선 0.35~0.45 가 보통입니다.

지켜야 할 것:
- 모든 id 는 영문으로 시작하고 영문·숫자·밑줄만 씁니다(식에서 참조되기 때문). 한글 이름은 desc 에 씁니다.
- 도면에 교재의 기호(A, B', ①)가 있으면 그 뜻을 살려 id 를 짓고 desc 에 원래 기호를 적습니다.
- 점은 **제도 순서대로** 나열합니다. 뒤에 오는 점이 앞의 점을 참조하게 하십시오.
- 곡선을 예쁘게 만들려고 통과점을 지어내지 마십시오. 교재에 있는 점만 쓰고, 필요하면 offset 으로 조금 밀어낸 보조점을 만들되 desc 에 그렇게 적습니다.
- 도면에서 못 읽은 값, 추정한 값, 헷갈린 부분은 반드시 notes 에 한 줄씩 남깁니다. 모르는 걸 그럴듯하게 채우지 마십시오.
- 기준 치수(B, 등길이 등)가 도면에 없으면 표준값을 넣고 notes 에 "도면에 없어 표준값 사용" 이라고 적습니다.

한 장의 이미지에 앞판·뒤판이 같이 있으면, 요청받은 조각 하나만 담으십시오(무엇을 담았는지 name 에 밝힙니다).`;

function imgBlock(file) {
  const ext = path.extname(file).toLowerCase();
  const media = MIME[ext];
  if (!media) throw new Error(`지원하지 않는 이미지 형식: ${ext} (${Object.keys(MIME).join(', ')})`);
  return { type: 'image', source: { type: 'base64', media_type: media, data: fs.readFileSync(file).toString('base64') } };
}

/** examples/fewshot/*.png + 같은 이름 .draft.json 짝을 few-shot 으로 싣는다.
 *  오버레이로 고쳐 놓은 결과를 여기 넣을수록 다음 페이지 인식률이 올라간다.
 *
 *  경로는 반드시 fileURLToPath 로 꺼낸다. URL.pathname 은 퍼센트 인코딩된 문자열이라
 *  리포 경로에 한글이 섞이면 path.join·existsSync 가 전부 빗나가 짝을 영영 못 찾는다. */
function fewshot() {
  const dir = fileURLToPath(new URL('../examples/fewshot/', import.meta.url));
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  // 순서를 고정해야 요청 앞부분이 매번 같아 프롬프트 캐시가 살아 있다
  for (const f of files.sort()) {
    if (!MIME[path.extname(f).toLowerCase()]) continue;
    const json = path.join(dir, f.replace(/\.[^.]+$/, '.draft.json'));
    if (!fs.existsSync(json)) {
      console.warn(`⚠ few-shot 건너뜀 — '${f}' 의 짝 '${path.basename(json)}' 이 없습니다`);
      continue;
    }
    out.push(
      { role: 'user', content: [imgBlock(path.join(dir, f)), { type: 'text', text: '이 제도 도면을 DSL 로 옮기십시오.' }] },
      { role: 'assistant', content: fs.readFileSync(json, 'utf8') },
    );
  }
  return out;
}

/** 요청에 실린 이미지의 base64 합계 (전송 크기와 거의 같다) */
function base64Bytes(messages) {
  let n = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'image' && b.source?.type === 'base64') n += b.source.data.length;
    }
  }
  return n;
}

const refFront = fs.readFileSync(new URL('../examples/bunka-front.draft.json', import.meta.url), 'utf8');
const refBack = fs.readFileSync(new URL('../examples/bunka-back.draft.json', import.meta.url), 'utf8');

const hint = opt('hint');
const name = opt('name') ?? path.basename(images[0]).replace(/\.[^.]+$/, '');

const userContent = [
  { type: 'text', text:
`아래는 이 DSL 로 쓴 참고 예시 두 개입니다. 문법과 서술 밀도를 여기에 맞추십시오.
(수치는 예시일 뿐이니 값을 베끼지 말고, 지금 주는 도면에서 읽어낸 것만 쓰십시오.)

<예시 앞판>
${refFront}
</예시 앞판>

<예시 뒤판>
${refBack}
</예시 뒤판>` },
  ...images.map(imgBlock),
  { type: 'text', text:
`위 도면(${images.length}장)을 DSL 로 옮기십시오.${hint ? `\n참고: ${hint}` : ''}

먼저 도면에 적힌 계산식과 기호를 전부 찾아 읽고, 제도 순서를 정한 다음 점을 배치하십시오.
읽어낸 계산식은 반드시 식 문자열로 남기십시오.` },
];

const client = new Anthropic();

async function ask(messages) {
  // max_tokens 는 thinking 과 응답 텍스트를 합쳐 재는 한도다. Opus 5 는 thinking 이 기본으로 켜져 있고
  // 도면 + few-shot + effort xhigh 면 생각만으로도 꽤 쓰므로 넉넉히 준다. 스트리밍이라 타임아웃 걱정은 없다.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    system: SYSTEM,
    output_config: { effort, format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
    messages,
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('모델이 요청을 거부했습니다.');
  if (msg.stop_reason === 'max_tokens') throw new Error('출력이 max_tokens 에서 잘렸습니다. 조각을 나눠 뽑으십시오.');
  const text = msg.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('텍스트 응답이 없습니다.');
  // content 를 통째로 돌려준다. 재시도 때 앞선 답을 문자열로 재구성하면 thinking 블록이 사라지는데,
  // 같은 모델로 대화를 이어갈 때는 받은 블록을 원형 그대로 되돌려주는 것이 규격이다
  // (display 가 기본 omitted 라 글자는 비어 있어도 블록 자체는 남겨야 한다).
  return { spec: JSON.parse(text), usage: msg.usage, content: msg.content };
}

const messages = [...fewshot(), { role: 'user', content: userContent }];

const imgBytes = base64Bytes(messages);
if (imgBytes > REQ_LIMIT * 0.8) {
  console.warn(`⚠ 이미지 base64 합계 ${(imgBytes / 1048576).toFixed(1)}MB — 요청 한도(${REQ_LIMIT / 1048576}MB)에 가깝습니다.`);
  console.warn('  장수를 줄이거나 해상도를 낮추십시오. 한도를 넘으면 요청 자체가 거부됩니다.');
}

console.log(`· 모델 ${MODEL} · effort ${effort} · 이미지 ${images.length}장 · few-shot ${(messages.length - 1) / 2}쌍 · 이미지 ${(imgBytes / 1048576).toFixed(1)}MB`);

let { spec, usage, content } = await ask(messages);
let errs = validate(spec);

// 스키마는 구조만 막는다. 참조 무결성·계산식이 깨졌으면 오류를 그대로 돌려주고 한 번 더 시킨다.
if (errs.length) {
  console.log(`· 1차 결과에 오류 ${errs.length}건 — 고쳐 달라고 되돌립니다`);
  ({ spec, usage, content } = await ask([
    ...messages,
    { role: 'assistant', content },
    { role: 'user', content: `검사기가 아래 오류를 냈습니다. 전체 DSL 을 고쳐서 다시 내십시오.\n\n${errs.map((e) => '- ' + e).join('\n')}` },
  ]));
  errs = validate(spec);
}

const outFile = path.join('out', `${name}.draft.json`);
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(spec, null, 2) + '\n');

console.log(`· 토큰 in ${usage.input_tokens} / out ${usage.output_tokens}`);
if (errs.length) {
  console.error(`✖ 아직 오류 ${errs.length}건 (파일은 남겨 두었으니 손으로 고치십시오) — ${outFile}`);
  for (const e of errs) console.error('  ' + e);
  process.exit(1);
}

const d = resolve(spec);
console.log(`✔ ${spec.name} → ${outFile}`);
console.log(`  치수 ${spec.measures.map((m) => `${m.id}=${m.value}`).join(' ')}`);
console.log(`  점 ${spec.points.length} · 선 ${spec.segments.length} · 다트 ${spec.darts.length} · 너치 ${spec.notches.length}`);
console.log(`  크기 ${(d.cutBbox.x1 - d.cutBbox.x0).toFixed(1)} × ${(d.cutBbox.y1 - d.cutBbox.y0).toFixed(1)} cm`);
if (spec.notes.length) {
  console.log('  메모:');
  for (const n of spec.notes) console.log('    · ' + n);
}
console.log(`\n다음: node tools/render.mjs ${outFile}`);
console.log(`      node tools/overlay.mjs ${outFile} ${images[0]}`);
