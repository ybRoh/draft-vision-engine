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
  obj({ ...POINT_BASE(), kind: { const: 'along', description: '곡선 위 호길이 비율 지점' },
        seg: str('어느 선 위인지 (segments 의 id)'),
        from: { enum: ['start', 'end'], description: '어느 끝에서부터 재는지. 진동 너치는 겨드랑(end)에서 잰다' },
        t: expr('그 선 전체 길이의 몇 배 지점인지. 0=끝점, 1=반대끝. 직선의 on 과 달리 **곡선을 따라간 길이** 기준') },
      '곡선 위를 실제로 따라간 길이로 잡는 점 (합인 너치 등). on 은 직선 비율이라 곡선에서는 어긋난다'),
  obj({ ...POINT_BASE(), kind: { const: 'intersect', description: '두 직선의 교점' },
        a1: str('직선1 시작점 id'), a2: str('직선1 끝점 id'),
        b1: str('직선2 시작점 id'), b2: str('직선2 끝점 id') },
      '두 직선의 교점 (어깨선 × 앞품선 등)'),
];

/* ── 선 ─────────────────────────────────────────────────────── */
const LAYERS = ['cut', 'guide', 'fold', 'dart', 'construction', 'compare'];

const SEGMENT_VARIANTS = [
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'line' },
    layer: { enum: LAYERS, description: 'cut=완성선 guide=안내선 fold=골선 dart=다트 construction=제도 보조 compare=원형비교패턴(빨강). compare 를 뺀 나머지는 전부 검정으로 그려지고 굵기·파선으로 구분한다' },
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
    via: str('곡선이 **지나가야 하는** 점 id. 교재가 "구성 사각형 꼭지점에서 2.5" 처럼 통과점을 지정하면 그 점을 넣는다. 없으면 빈 문자열 — 그러면 제도법이 곡선을 알아서 정한다'),
  }, '목선. 양 끝 접선(중심에서 수평 · 옆목점에서 어깨선과 직각)은 제도법이 잡고, 통과점은 via 로 줄 수 있다'),
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'armhole' },
    layer: { enum: LAYERS },
    shoulder: str('어깨끝점 id (SP) — 곡선 시작'),
    neck: str('옆목점 id (SNP) — 어깨선 방향을 잡는 데만 쓴다. 곡선은 여기를 지나지 않는다'),
    pitch: str('앞품점/뒤품점 id — **x 좌표만** 쓴다. 높이는 어깨~겨드랑 중간으로 제도법이 정한다'),
    bottom: str('겨드랑점 id — 곡선 끝(옆선이 시작하는 곳)'),
  }, '암홀(진동). 제도법으로 곡선이 정해지므로 통과점을 찍지 않는다'),
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'armhole_sleeveless' },
    layer: { enum: LAYERS },
    shoulder: str('어깨끝점 id — 곡선 시작'),
    neck: str('옆목점 id — 어깨선 방향과 안쪽 방향을 잡는 데만 쓴다. 곡선은 지나지 않는다'),
    pitch: str('앞품/뒤품점 id — **y(높이)만** 쓴다. 이 높이에서 가장 많이 판다'),
    bottom: str('겨드랑점 id — 곡선 끝'),
    scoop: expr('품 높이에서 현(어깨끝→겨드랑)보다 안쪽으로 파는 양. 도해 2.5'),
    side: str('겨드랑 **다음** 옆선 위의 점 id (보통 옆선 허리점). 진동이 옆선과 직각으로 만나게 한다 — 각이 지면 앞뒤판을 박았을 때 진동에 꺾임이 생긴다'),
  }, '민소매 진동. 셋인(armhole)과 달리 전 구간이 안쪽으로 파인다 — 소매가 들어갈 자리가 없기 때문'),
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'traced' },
    layer: { enum: LAYERS },
    compare: str('가져올 원형 — compare 절의 id'),
    seg: str('그 원형에서 가져올 선의 id (예: "armhole")'),
    start: str('가져온 곡선의 **시작 끝**을 옮겨 붙일 점 id'),
    end: str('가져온 곡선의 **끝 끝**을 옮겨 붙일 점 id'),
    startPerp: str('시작에서 이 점→start 방향과 **직각**이 되게 접선을 바로잡는다. 진동이면 옆목점(어깨선과 직각). 안 고칠 거면 빈 문자열'),
    endPerp: str('끝에서 이 점→end 방향과 **직각**이 되게 바로잡는다. 진동이면 옆선의 다음 점. 안 고칠 거면 빈 문자열'),
  }, '원형의 선을 물려받아 양 끝만 옮겨 그린다. 곡선 성격을 새로 만들지 않는다 — 응용 패턴의 진동·목선을 원형에서 따올 때 쓴다'),
  obj({
    id: str('선 이름'), desc: str('무슨 선인지 한국어 한 줄'),
    kind: { const: 'sleevecap' },
    layer: { enum: LAYERS },
    apex: str('소매산 정점을 놓을 점 id'),
    frontAH: expr('앞 암홀 길이. 보통 refs 로 몸판에서 가져온 이름'),
    backAH: expr('뒤 암홀 길이'),
    capHeight: expr('소매산 높이. 0 이면 자동 AH/4+2 (도해). 낮출수록 소매통이 넓어진다'),
    frontReduce: expr('앞 대각선에서 뺄 값. 도해 "앞AH − 0~1". 이세를 줄이려면 크게'),
    backReduce: expr('뒤 대각선에서 뺄 값. 도해 "뒤AH − 0~1"'),
    frontRise: expr('앞 소매산 AH/8 지점 볼록량 (도해 1.8)'),
    backRise: expr('뒤 소매산 AH/8 지점 볼록량 (도해 1.9)'),
    produces: obj({
      front: str('앞 겨드랑 코너가 될 점 id'),
      back: str('뒤 겨드랑 코너가 될 점 id'),
      notchFront: str('앞 소매산 합인 너치가 될 점 id'),
      notchBack: str('뒤 소매산 합인 너치가 될 점 id'),
    }, '소매산이 역산해 만들어 내는 점들. 소맷부리·옆선이 이 점을 참조한다'),
  }, '소매산(반소매 원형). 폭을 주지 않는다 — 대각선 길이 = 앞AH−0~1 / 뒤AH−0~1 로 정해진다. 이세는 결과다'),
];

/* ── 전체 ───────────────────────────────────────────────────── */
export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'name', 'source', 'units', 'measures', 'params', 'refs', 'compare', 'dims', 'points', 'segments', 'darts', 'notches', 'notes'],
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

    refs: {
      type: 'array',
      description: '다른 조각(파일)에서 가져오는 값. 소매가 몸판 암홀 길이를 받을 때 쓴다. 없으면 빈 배열',
      items: obj({
        id: str('식에서 쓸 이름 (FAH, BAH…)'),
        desc: str('한국어 설명'),
        draft: str('가져올 draft.json 경로. 이 파일이 있는 폴더 기준 상대경로'),
        take: { enum: ['segmentLength', 'pointX', 'pointY'], description: '무엇을 가져올지' },
        of: str('segmentLength 면 선 id, pointX/pointY 면 점 id'),
      }),
    },

    compare: {
      type: 'array',
      description: '원형비교패턴 — 다른 조각(원형)의 완성선을 이 도면 위에 **빨간 가는 선**으로 겹쳐 그린다. 응용 패턴이 원형에서 어디가 달라졌는지 눈으로 본다. 없으면 빈 배열',
      items: obj({
        id: str('비교 대상 이름'),
        desc: str('무엇과 비교하는지 한국어 한 줄'),
        draft: str('겹쳐 그릴 원형 draft.json 경로. 이 파일이 있는 폴더 기준 상대경로'),
        dx: expr('가로로 옮겨 맞출 양(cm). 원점이 같으면 0'),
        dy: expr('세로로 옮겨 맞출 양(cm). 원점이 같으면 0'),
      }),
    },

    dims: {
      type: 'array',
      description: '치수선. **도해에 적힌 계산식을 그대로** 도면에 표시한다. 교재 도면처럼 어디를 어떤 식으로 잡았는지 보이게 하는 것이 목적이다. 없으면 빈 배열',
      items: obj({
        id: str('치수선 이름'),
        desc: str('한국어 설명'),
        a: str('재기 시작하는 점 id'),
        b: str('재기 끝나는 점 id'),
        label: str('도해에 적힌 식 그대로. 예: "B/4+여유분 1.5", "B/12+0.3"'),
        axis: { enum: ['x', 'y', 'both'], description: '무엇을 재는지. x=가로 성분만, y=세로 성분만, both=두 점 사이 실거리. 교재 치수선은 대개 x 나 y 다 — both 로 두면 옆목 올림·어깨 경사 같은 성분이 섞여 식과 값이 어긋난다' },
        offset: expr('치수선을 재는 선에서 얼마나 띄울지(cm). **조각 안쪽에 두는 것이 원칙** — 바깥에 두면 인쇄·네스팅 때 잘린다. 부호는 방향이며, 세로 치수선끼리는 계단식으로 띄워 겹치지 않게 한다'),
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
