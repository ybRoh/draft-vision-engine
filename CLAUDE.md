# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

**제도인식엔진** — 교재 제도 도면 이미지를 Claude Vision 으로 읽어 **계산식 기반 제도 사양(DSL)** 으로 옮기고, 그것을 실행해 SVG·DXF 를 뽑는다. 좌표가 아니라 계산식(`B/12+2.5`)을 뽑는 것이 존재 이유다 — 그래야 치수를 바꿨을 때 도면이 따라온다. DSL 문법과 사용법은 [README.md](README.md) 에 있다.

의존성은 `@anthropic-ai/sdk` 하나뿐이고 `tools/extract.mjs` 에서만 쓴다. `lib/` 와 검증은 의존성 0.

## 구성

### `lib/` — 제도 엔진 (의존성 0)

- **`expr.mjs`** — 계산식 평가기. 토크나이저 → Pratt 파서 → 순수 계산. `evalExpr(식, scope)` · `deps(식)`. 함수 표는 `FN`(이름 → `[인자 수, 함수]`), 문서·검증용 이름 목록은 `FUNCS`. 교재 OCR 표기(`×` `÷` `−` 전각 괄호…)를 `normalize` 로 흡수하고, 인자 수·정의역·토큰 2000개·괄호 100겹을 검사한다
- **`schema.mjs`** — DSL(`draft-spec v1`) 정의 한 곳. `extract` 의 structured output 스키마이자 `validate` 의 검사 대상. `LAYER_LIST` 도 여기서 나간다
- **`draft.mjs`** — 엔진의 심장. DSL → 좌표. 점 위상정렬 · `resolve(spec, overrides)` · `DraftError`
- **`curve.mjs`** — Freesewing(Brian block) through 곡선 · 베지어 길이(`segsLen`) · 폴리라인 길이(`polyLen`) · 직선 교점(`lineIntersect`). 벡터 헬퍼 `V`
- **`svg.mjs`** — 도형 → SVG. cm 좌표 그대로 + `viewBox`, 1cm 모눈, 5cm 자
- **`dxf.mjs`** — 도형 → DXF R12. `toDXF(drawing, {scale, textHeight, labels, title})` · 검증용 되읽기 `parseDXF` · 논리 레이어 → DXF 레이어 이름표 `DXF_LAYER` · `hasNonAscii`
- **`validate.mjs`** — 구조(스키마) + 의미(참조 무결성 · **계산식**) 검사. 오류 문자열 배열을 돌려준다

### `tools/`

- **`render.mjs`** — DSL → SVG + DXF. `--out` `--set 이름=값` `--labels` `--no-points` `--no-title`. `--이름=값` 도 받고, 모르는 플래그·값 빠진 플래그는 종료코드 2, 도면 오류는 한 줄 메시지 + 1
- **`extract.mjs`** — 이미지 → DSL (Claude Vision). `--name` `--hint` `--effort low|medium|high|xhigh|max`(기본 `xhigh`). 인증은 `ANTHROPIC_API_KEY` 또는 `ant auth login`
- **`overlay.mjs`** — 도면을 원본 사진 위에 얹어 배율·이동·회전을 맞춰 보는 단일 HTML 을 만든다(외부 의존 0, 사진은 data URI). `--out` `--set`. 2점 배율 맞추기 · 레이어 토글 · 변환값 JSON 복사
- **`verify_expr.mjs`** — 식 평가기 (우선순위·결합 · `-2^2 = -4` · OCR 표기 · 인자 수 · 정의역 · 프로토타입 이름 · eval 이 아님)
- **`verify_draft.mjs`** — DSL 해석 (손계산 대조 · 곡선 길이·중간점 고정 · 잘못된 DSL 걷어내기 · 참조 고리 · 평행선)
- **`verify_grade.mjs`** — 그레이딩 (44~88호 단조 증가 · 폭 증가가 `B/4` 와 맞는지 · 앞뒤 암홀 합)
- **`verify_dxf.mjs`** — DXF 가 CAD 에서 열리는 것 (형식 · 테이블 · LTYPE 40=|49| 합 · 엔티티 수 · ENTITIES 의 VERTEX 만 골라 배율·y 뒤집기 · `$EXTMIN/$EXTMAX` · 값 개행)

### 그 밖

- `examples/` — 데모 픽스처 앞·뒤판 (아래 주의 참고), `examples/fewshot/` — 이미지 + 같은 이름 `.draft.json` 짝을 넣으면 `extract` 가 자동으로 실어 보낸다
- `out/` — 렌더·추출 결과가 쌓이는 곳

## 불변 규칙

- **좌표계: x 오른쪽 +, y 아래 +.** 화면·기존 패턴 앱들과 같다. `polar` 의 각도는 도(degree)이고 양수가 화면상 위쪽이라 **어깨경사는 음수각**이다
- **단위는 cm.** 전부. DXF 로 나갈 때만 10배해 mm 로 바꾸고 y 부호를 뒤집는다(DXF 는 y 가 위쪽)
- **식은 문자열, 숫자도 허용.** 숫자를 박아 넣지 말 것 — 그러면 그레이딩이 죽고 `verify_grade` 가 잡는다. 치수와 무관한 상수는 `params` 로 빼서 이름을 붙인다
- **`eval()` 을 쓰지 않는다.** 식의 출처가 이미지를 읽은 모델이라 임의 코드가 섞여 들어올 수 있다. 함수를 늘릴 일이 있으면 `expr.mjs` 의 `FN` 에 `[인자 수, 함수]` 로 추가하고(가변이면 `-1`) `verify_expr` 에 케이스를 붙인다. 인자 수를 안 재면 `round(B/4, 1)` 이 여분 인자를 조용히 버리고 틀린 값을 낸다
- **NaN 이 좌표로 새어 나가지 않게 한다.** 0 나눗셈·0 나머지, `sqrt(-1)`·`asin(2)` 같은 정의역 밖, 무한대로 넘치는 곱셈·거듭제곱은 전부 그 자리에서 `ExprError` 다. 새 함수를 넣을 때도 결과를 `finite()` 로 통과시킬 것
- **단항 마이너스는 `^` 보다 약하다.** `-2^2 = -4` (수학·파이썬 관례). `^` 는 `BIN` 표에 없고 `power()`/`unary()` 가 따로 처리하니 우선순위를 만질 때 그 구조를 깨지 말 것
- **id 는 영문으로 시작, 영문·숫자·밑줄만.** 식에서 참조되기 때문. 한글 이름은 `desc` 에. `measures`·`params`·`points` 가 같은 이름공간을 쓰므로 겹치면 터진다
- **DSL 필드는 전부 필수다.** structured output 제약(`required: 전체 키` + `additionalProperties: false`)이라 선택 항목이 없다. `desc`·`closed`·`tension` 도 생략 불가, 빈 배열도 명시
- **DXF 는 R12(AC1009) 이고 `LWPOLYLINE` 금지** — R14 엔티티라 R12 선언 파일에 넣으면 LibreCAD·구형 CAM 이 파일을 거부한다. `POLYLINE` + `VERTEX` + `SEQEND` 를 쓴다. 같은 이유의 규칙이 더 있다(전부 `dxf.mjs` 주석에 근거가 있다):
  - STYLE 테이블에 `STANDARD` 가 없으면 TEXT 가 통째로 안 그려진다
  - LTYPE 테이블에 없는 선종류를 레이어가 참조하면 파일이 거부된다. LTYPE 의 `40`(무늬 전체 길이)은 `49` 요소들의 절대값 합이어야 한다
  - TEXT 는 가운데 정렬 코드(72/11)를 쓰지 않는다 — 리더마다 지원이 갈려 글자가 사라진다
  - 줄바꿈은 CRLF (일부 CAM 이 LF 를 거부한다). **값 문자열의 개행은 없앤다** — DXF 는 줄 단위 포맷이라 값 안의 `\n` 하나가 뒤의 모든 코드/값을 밀어 파일을 못 읽게 만든다. 도면 이름은 모델이 써넣는 문자열이라 두 줄짜리 제목이 실제로 들어온다
  - 레이어 `0` 은 예약 레이어라 LAYER 테이블에 명시한다. 닫힌 폴리라인은 중복 정점 대신 `70`=1 로 닫는다(중복 정점은 CAM 에서 길이 0 이동·재절단을 만든다)
  - `$EXTMIN/$EXTMAX` 는 `bbox` 가 아니라 **실제로 그린 모든 점**에서 누적한다. 제목·라벨·너치 원은 `bbox` 밖에 그려져 Zoom Extents 에서 잘린다
- **DXF 레이어 이름은 대문자다.** DSL 의 `layer`(소문자 `cut`·`guide`·`fold`·`dart`·`construction`) → DXF `CUT`·`GUIDE`·`FOLD`·`DART`·`CONSTRUCTION`, 그리고 `NOTCH`·`TEXT`. 매핑은 `dxf.mjs` 의 `DXF_LAYER` 하나뿐이니 이름을 바꿀 일이 있으면 거기서만 바꾸고 `verify_dxf` 가 `DXF_LAYER` 를 통해 보게 둘 것 (R12 리더 중 레이어 이름을 대문자로 정규화하는 것이 있어 처음부터 대문자로 쓴다)
- **DXF 제목에 한글이 들어가면 구형 CAM 에서 깨진다** — `STANDARD` 폰트(`txt.shx`)에 한글 글리프가 없다. 탈출구는 `toDXF(d, { title: false })` — CLI 로는 `render.mjs --no-title` 이다. 끄더라도 이름은 999 주석에 남는다
- **조각의 실제 크기는 `cutBbox` 다** (`cut`·`fold` 선 + 다트 + 너치). `bbox` 는 보조점까지 감싼 액자용이라 치수를 따라 자라지 않는다 — 그레이딩 검증·용지 배치는 `cutBbox` 를 볼 것
- **곡선 길이는 베지어에서 잰다** (`segsLen`). 24분할 폴리라인(`flatten`)은 화면·DXF 출력용이고, 그걸로 재면 급곡선에서 0.01cm 넘게 짧게 나온다 — 암홀 길이를 소수 둘째 자리까지 보는 도구에서는 그대로 오차가 된다
- **`intersect` 는 평행과 퇴화를 구분해 다른 오류를 낸다.** 평행 판정은 절대 epsilon 이 아니라 **두 방향벡터 길이에 비례한 상대 오차**로 한다. 절대값을 쓰면 거의 평행한 선의 교점이 아주 먼 곳으로 날아가고, 그 점이 `bbox` 에 들어가 도면 액자를 통째로 망가뜨린다

## 작업 규칙

- **무언가 고친 뒤에는 반드시 `npm test`** — `verify_expr` → `verify_draft` → `verify_grade` → `verify_dxf` 넷이 돈다. 몇 초면 끝난다
- **DSL 을 확장할 때는 네 곳을 같이 고친다**: `lib/schema.mjs`(정의) · `lib/validate.mjs`(참조 무결성·계산식 검사) · `lib/draft.mjs`(해석) · [README.md](README.md) 의 DSL 레퍼런스. 하나라도 빠지면 스키마는 통과하는데 엔진이 못 푸는 DSL 이 생기거나, 문서에 없는 기능이 조용히 자란다. 새 `kind` 를 넣으면 `validate.mjs` 의 `EXPR_FIELDS` 에 식이 든 칸을 등록하고, `verify_draft` 에 "잘못 쓰면 걸린다" 는 케이스도 같이 붙일 것
- **`validate()` 는 `resolve()` 가 터지기 전에 잡아야 할 것을 다 잡는다.** 검사기가 못 보는 오류는 `extract.mjs` 의 "고쳐 달라" 재시도를 못 돌리고, API 를 한 번 다 쓴 뒤 스택트레이스로 죽는 것으로 나타난다. 새 검사를 넣을 때는 `mustFail` 케이스를 `verify_draft` 에 같이 붙일 것
- **CLI 는 `ARITY` 표로 인자를 가른다** (`render.mjs`·`extract.mjs` 가 같은 `parseArgs`). 새 플래그를 넣으면 값을 받는지(`1`/`0`)를 표에 적어야 하고, 안 적으면 "모르는 플래그" 로 거절된다. 쓰는 사람의 실수는 종료코드 2, 도면·식의 오류는 한 줄 메시지 + 1 — 이 구분을 유지할 것
- 렌더링·검증 코드에 새 의존성을 들이지 말 것 (`lib/` 와 verify 는 의존성 0 을 유지한다)
- `tools/extract.mjs` 의 시스템 프롬프트는 "좌표가 아니라 계산식" 원칙을 모델에 못 박는 자리다 — 손댈 때 그 원칙이 흐려지지 않게 할 것. few-shot 은 파일 이름 순으로 고정 정렬해 싣는다(요청 앞부분이 같아야 프롬프트 캐시가 산다)

## 주의: 예제는 실제 교재가 아니다

`examples/bunka-front.draft.json` · `bunka-back.draft.json` 은 **데모 픽스처**다. 문화식 계열 계산식을 본떴을 뿐 특정 교재의 전사본이 아니고, 제도값을 실무에 그대로 쓸 물건이 아니다(파일 안 `source.book` 과 `notes` 에도 그렇게 적혀 있다).

동시에 이 둘은 검증 스크립트 셋의 **고정 픽스처**이기도 하다 — `verify_draft` 가 점 이름(`SNP`·`SP`·`BP`…)과 좌표를 손계산 값과 직접 대조하고, `verify_grade`·`verify_dxf` 가 선 이름(`armhole`·`shoulder`·`neck`)과 레이어 구성·엔티티 개수를 기대한다. 예제를 고치면 그 검증들이 같이 터지므로 함께 고칠 것. 실제 교재 페이지를 뽑은 결과는 `out/` 에 두고, 픽스처를 덮어쓰지 않는다.
