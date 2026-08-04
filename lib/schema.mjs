/* 제도 DSL(draft-spec v1) 스키마.
 *
 * 두 곳에서 쓴다.
 *   1) tools/extract.mjs — Claude API 의 structured output(json_schema)으로 넘겨
 *      모델이 이 모양을 **벗어날 수 없게** 강제한다.
 *   2) lib/validate.mjs — 사람이 손으로 쓴 DSL 검사.
 *
 * structured output 제약에 맞춘다: 객체마다 additionalProperties:false + required 전부,
 * 선택 항목은 anyOf 분기로 뺀다(재귀·minLength 등은 못 쓴다).
 */

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
/* 식은 문자열(계산식) 또는 숫자 둘 다 허용한다.
 * type: ['string','number'] 로 쓰면 structured output 지원 여부가 불확실하다 —
 * 문서에 명시된 anyOf 로 적어 400 위험을 없앤다. */
const expr = (description) => ({ anyOf: [{ type: 'string' }, { type: 'number' }], description });

const obj = (properties, description) => ({
  type: 'object', description, properties,
  required: Object.keys(properties), additionalProperties: false,
});

/* ── 점: 다섯 가지 지정 방식 ────────────────────────────────── */
/* 매번 새 객체를 만든다 — 공유 참조를 쓰면 나중에 한 곳의 설명을 고칠 때 5개가 같이 바뀐다 */
const POINT_BASE = () => ({
  id: str('점 이름. 영문/숫자/밑줄. 교재의 기호가 있으면 그대로(A, B, SNP…)'),
  desc: str('이 점이 무엇인지 한국어 한 줄 (예: 앞 옆목점)'),
});

const POINT_VARIANTS = [
  obj({ ...POINT_BASE(), kind: { const: 'xy', description: '절대 좌표' },
        x: expr('x 좌표 식. 예: "B/4+1"'), y: expr('y 좌표 식. y 는 아래가 +') },
      '좌표를 식으로 직접 준다'),
  obj({ ...POINT_BASE(), kind: { const: 'offset', description: '다른 점에서 가로세로 이동' },
        from: str('기준점 id'), dx: expr('가로 이동 식'), dy: expr('세로 이동 식(아래가 +)') },
      '기준점에서 dx,dy 만큼'),
  obj({ ...POINT_BASE(), kind: { const: 'polar', description: '다른 점에서 각도+거리' },
        from: str('기준점 id'),
        angle: expr('각도(도). 0=오른쪽, 양수=화면상 반시계(위쪽). 어깨경사는 보통 음수'),
        dist: expr('거리 식') },
      '기준점에서 각도·거리로 (어깨선 등)'),
  obj({ ...POINT_BASE(), kind: { const: 'on', description: '두 점을 잇는 선 위의 비율 위치' },
        a: str('시작점 id'), b: str('끝점 id'), t: expr('0=a, 1=b. 3등분이면 1/3') },
      '선분 위 비율 지점 (교재의 "n등분")'),
  obj({ ...POINT_BASE(), kind: { const: 'intersect', description: '두 직선의 교점' },
        a1: str('직선1 시작점 id'), a2: str('직선1 끝점 id'),
        b1: str('직선2 시작점 id'), b2: str('직선2 끝점 id') },
      '두 직선의 교점 (어깨선 × 앞품선 등)'),
];

/* ── 선 ─────────────────────────────────────────────────────── */
const LAYERS = ['cut', 'guide', 'fold', 'dart', 'construction'];

const SEGMENT_VARIANTS = [
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'line' },
    layer: { enum: LAYERS, description: 'cut=완성선(실선) guide=안내선(점선) fold=골선 dart=다트 construction=제도 보조' },
    pts: { type: 'array', items: str('점 id'), description: '순서대로 이을 점 id 들' },
    closed: { type: 'boolean', description: '마지막 점을 첫 점과 잇는지' },
  }, '직선(폴리라인)'),
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'curve' },
    layer: { enum: LAYERS },
    through: { type: 'array', items: str('점 id'), description: '곡선이 지나갈 점 id 들 (2개 이상)' },
    tension: num('곡선 팽팽함. 0.42 가 기본. 옆선·밑단 0.35~0.5'),
  }, '통과점을 주는 자유 곡선 (옆선·밑단·다트 곡선 등). **목선·암홀에는 쓰지 말 것** — 아래 전용 kind 가 있다'),
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'neck' },
    layer: { enum: LAYERS },
    center: str('앞/뒤 중심 목점 id (FNP·BNP)'),
    snp: str('옆목점 id (SNP)'),
    shoulder: str('어깨끝점 id (SP) — 어깨선 방향을 잡는 데만 쓴다. 곡선은 여기를 지나지 않는다'),
  }, '목선. 제도법으로 곡선이 정해지므로 통과점을 찍지 않는다'),
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'armhole' },
    layer: { enum: LAYERS },
    shoulder: str('어깨끝점 id (SP) — 곡선 시작'),
    neck: str('옆목점 id (SNP) — 어깨선 방향을 잡는 데만 쓴다. 곡선은 여기를 지나지 않는다'),
    pitch: str('앞품점/뒤품점 id — **x 좌표만** 쓴다. 높이는 어깨~겨드랑 중간으로 제도법이 정한다'),
    bottom: str('겨드랑점 id — 곡선 끝(옆선이 시작하는 곳)'),
  }, '암홀(진동). 제도법으로 곡선이 정해지므로 통과점을 찍지 않는다'),
];

/* ── 전체 ───────────────────────────────────────────────────── */
export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'name', 'source', 'units', 'measures', 'params', 'points', 'segments', 'darts', 'notches', 'notes'],
  properties: {
    version: { const: 1 },
    name: str('제도명. 예: 문화식 상의 원형 앞판'),
    source: obj({
      book: str('교재명 (모르면 "미상")'),
      page: str('쪽수 (모르면 "미상")'),
    }, '출처'),
    units: { const: 'cm', description: '모든 수치는 cm' },

    measures: {
      type: 'array',
      description: '도면에 쓰인 인체 치수·기준값. 식 안에서 이름으로 참조된다',
      items: obj({
        id: str('식에서 쓸 이름. 영문 (B, W, WL, SW…)'),
        desc: str('한국어 이름 (가슴둘레, 등길이…)'),
        value: num('도면에 적힌 기준 치수. 없으면 표준값을 넣고 notes 에 적는다'),
      }),
    },
    params: {
      type: 'array',
      description: '여유분·경사각 등 제도 상수. 도면에 적힌 숫자를 이름 붙여 뺀다',
      items: obj({
        id: str('식에서 쓸 이름'),
        desc: str('한국어 설명'),
        value: num('값'),
      }),
    },

    points: { type: 'array', description: '제도 순서대로', items: { anyOf: POINT_VARIANTS } },
    segments: { type: 'array', description: '점을 잇는 선들', items: { anyOf: SEGMENT_VARIANTS } },

    darts: {
      type: 'array',
      description: '다트. 없으면 빈 배열',
      items: obj({
        id: str('다트 이름'),
        desc: str('한국어 설명 (허리다트, 가슴다트…)'),
        apex: str('다트 꼭짓점 id (BP 등)'),
        leg1: str('다트 한쪽 다리 끝점 id'),
        leg2: str('다트 반대쪽 다리 끝점 id'),
      }),
    },
    notches: {
      type: 'array',
      description: '너치(합인) 표시. 없으면 빈 배열',
      items: obj({
        id: str('너치 이름'),
        desc: str('한국어 설명'),
        at: str('너치를 찍을 점 id'),
      }),
    },

    notes: {
      type: 'array',
      description: '도면에서 읽어냈지만 위 구조로 못 담은 것, 추정한 값, 확신 없는 부분',
      items: str('한 줄 메모'),
    },
  },
};

export const LAYER_LIST = LAYERS;
