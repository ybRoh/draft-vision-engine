#!/usr/bin/env node
/* 식 평가기 검증. 계산이 틀리면 도면 전체가 틀린다 — 여기가 1번 방어선. */
import { evalExpr, deps } from '../lib/expr.mjs';

let fail = 0;
const scope = { B: 86, WL: 38, SNP: { x: 7.2, y: 0 }, SP: { x: 19.5, y: 4.97 } };

const eq = (src, want, tol = 1e-9) => {
  let got;
  try { got = evalExpr(src, scope); }
  catch (e) { console.error(`✖ ${src}\n    던짐: ${e.message}`); fail++; return; }
  if (Math.abs(got - want) > tol) { console.error(`✖ ${src}\n    기대 ${want} · 실제 ${got}`); fail++; }
};
const throws = (src, needle) => {
  try { evalExpr(src, scope); }
  catch (e) {
    if (needle && !e.message.includes(needle)) { console.error(`✖ ${src}\n    다른 오류: ${e.message}`); fail++; }
    return;
  }
  console.error(`✖ ${src}\n    던져야 하는데 통과했다`); fail++;
};

// 사칙연산 · 우선순위
eq('1+2*3', 7);
eq('(1+2)*3', 9);
eq('10-3-2', 5);                 // 좌결합
eq('2^3^2', 512);                // 우결합
eq('-B/2', -43);
eq('7 % 3', 1);

// 교재 계산식
eq('B/12+2.5', 86 / 12 + 2.5);
eq('B/4+1', 22.5);
eq('B/20+2.9', 7.2);
eq('B/6+7', 86 / 6 + 7);

// 점 참조
eq('SNP.x', 7.2);
eq('SP.x-SNP.x', 12.3);
eq('hypot(SP.x-SNP.x, SP.y-SNP.y)', Math.hypot(12.3, 4.97), 1e-12);

// 도 단위 삼각함수
eq('sin(30)', 0.5, 1e-12);
eq('cos(0)', 1);
eq('tan(45)', 1, 1e-12);
eq('atan2(1,1)', 45, 1e-12);
eq('deg(rad(37))', 37, 1e-12);

// 단항 마이너스는 거듭제곱보다 **약하게** 묶인다 (-2^2 = -4, 수학·파이썬 관례)
eq('-2^2', -4);
eq('0-2^2', -4);
eq('2^-1', 0.5);
eq('-B^2', -7396);

// 교재 OCR 표기 흡수 — 모델이 ×, 유니코드 −, 전각 괄호를 그대로 써 온다
eq('B×1/2', 43);
eq('B÷2', 43);
eq('B−2', 84);
eq('（B/4）+1', 22.5);
eq('.5+1', 1.5);

// 오류 처리
throws('B/0', '0 으로 나눴');
throws('B%0', '0 으로 나눈 나머지');

// 인자 수 — round(x,1) 을 그냥 흘려보내면 조용히 틀린 값이 나온다
throws('round(2.55, 1)', "함수 'round' 은 인자 1개");
throws('sqrt(4, 9)', '인자 1개');
throws('min()', '인자 1개 이상');
throws('atan2(1)', '인자 2개');

// 정의역 밖 → NaN 이 새어 나가면 안 된다
throws('sqrt(0-1)', '숫자가 아니다');
throws('asin(2)', '숫자가 아니다');

// 프로토타입 체인이 뚫리면 함수가 좌표로 흘러든다
throws('constructor', "'constructor' 을 모른다");
throws('toString(1)', "함수 'toString'");
throws('isPrototypeOf(1)', "함수 'isPrototypeOf'");
throws('valueOf', "'valueOf' 을 모른다");

// 신뢰 못 할 입력 방어
throws('('.repeat(200) + '1' + ')'.repeat(200), '깊다');
throws('1+'.repeat(3000) + '1', '너무 길다');

// 곱셈 기호 누락은 원인을 짚어준다
throws('1/3B', '곱셈 기호');
throws('Q+1', "'Q' 을 모른다");
throws('SNP.z', "'SNP.z' 을 모른다");
throws('nope(1)', "함수 'nope'");
throws('1+', '식이 끊겼');
throws('1 2', '군더더기');
throws('B; process.exit(1)', '알 수 없는 문자');   // eval 이 아님을 확인
throws('B.constructor', "'B.constructor' 을 모른다");

// 의존성 추출
const d = deps('hypot(SP.x-SNP.x, SP.y-SNP.y)+SH_EASE').sort();
if (JSON.stringify(d) !== JSON.stringify(['SH_EASE', 'SNP', 'SP'])) {
  console.error(`✖ deps: ${JSON.stringify(d)}`); fail++;
}
if (deps(12).length !== 0) { console.error('✖ deps(숫자)'); fail++; }
if (deps('PI*2').length !== 0) { console.error('✖ deps(상수 PI 는 의존이 아니다)'); fail++; }

console.log(fail ? `✖ verify_expr: ${fail}건 실패` : '✔ verify_expr');
process.exit(fail ? 1 : 0);
