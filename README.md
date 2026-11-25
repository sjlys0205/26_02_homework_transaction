# 과제 2 신청 승인 서비스 시작 코드

신청·대기 취소·직접 승인·승인 취소·대기열 자동 승급·변경 이력을 구현합니다. 상위 폴더의 [안내문](../01_과제2_안내문.pdf)과 [API 계약](docs/API.md)을 먼저 읽으세요.

**제출 마감: 2026년 11월 25일 23:59 (한국 시간)**

## 실행

Node.js **24.x**와 npm이 필요합니다. Node.js 20은 지원하지 않습니다. SQLite는 Node 내장 모듈입니다.

```sh
node --version
npm ci
npm test
npm start
```

http://127.0.0.1:3000 에 접속합니다. Ctrl+C로 종료합니다.

- 포트 사용 중: 기존 실행 터미널을 종료하거나 다른 포트를 사용합니다.
- macOS / Linux: `PORT=3001 npm start`
- Windows PowerShell: `$env:PORT="3001"; npm start`
- 첫 실행: `data/app.sqlite`와 `data/jwt-secret.txt`가 자동 생성됩니다.
- 브라우저 로그인 토큰은 메모리에만 저장합니다. 새로고침 후 다시 로그인하세요. DB 데이터는 유지됩니다.

## 연습 계정

공통 비밀번호는 `Classroom123!`입니다. 실제 이용자가 아닌 가상 계정입니다.

|아이디|이름|역할|
|---|---|---|
|alice|민지|학생|
|bob|준호|학생|
|charlie|서연|학생|
|manager1|운영자 A|행사 1 담당 · 정원 2명|
|manager2|운영자 B|행사 2 담당 · 정원 1명|

로그인 화면의 계정 버튼으로 입력값을 채우고 로그인 버튼을 누릅니다. 각 탭은 별도 토큰을 사용하므로 일반 탭 여러 개로 역할을 나눌 수 있습니다.

## 제공 코드와 구현할 부분

로그인·JWT 인증, 스키마와 가상 계정, 조회 API와 권한 검사, 입력 형식 검사, 기본 화면, SQL 조회·저장 도구를 제공합니다.

`src/application-service.js`의 TODO 4개는 초기 상태에서 501을 반환합니다.

1. `apply`: 행사·학생·중복 검사, PENDING 저장과 APPLY 이력
2. `cancel`: 학생 본인의 PENDING 취소, CANCELLED와 CANCEL 이력
3. `approve`: 담당자·상태·정원 검사, APPROVED와 APPROVE 이력
4. `revoke`: 담당자의 승인 취소, 다음 대기자 1명 승급, 두 이력의 원인 연결

모든 상태 변경과 이력 저장을 트랜잭션으로 묶으세요. 특히 revoke에서는 신청 2건과 이력 2건의 부분 저장을 막아야 합니다. 대기자 선택, 업무 규칙, 이력 저장 시점, 트랜잭션 경계는 학생 구현입니다. repository 함수 자체는 권한을 검사하지 않습니다. 보조 함수·SQL·파일은 필요하면 추가할 수 있습니다.

## 테스트

```sh
npm test
npm run test:assignment
npm run test:advanced
```

- `npm test`: 제공 기반 기능 4개. 구현 전과 후 모두 통과해야 합니다.
- `test:assignment`: 필수 32개. TODO 구현 전 일부 실패가 정상입니다.
- `test:advanced`: 선택 심화. 서버 2개가 마지막 자리를 동시에 승인하는 검사를 20회 수행합니다. 미수행은 감점하지 않습니다.

테스트는 별도 임시 DB·포트를 사용합니다. 필수 테스트 T28~T30은 임시 DB 트리거로 이력 저장 실패를 주입합니다. `TEST_INJECTED_FAILURE` 로그는 이 검사의 의도된 오류입니다. HTTP 500뿐 아니라 상태·이력 전체가 요청 전과 같은지 검사합니다. 테스트가 오류를 흉내 내므로 실제 서비스 코드에 특별 처리를 넣지 마세요. 기대값 변경이나 테스트 삭제는 허용하지 않습니다.

## 화면 검증

- U01: alice 신청 → manager1 승인 → 학생이 최신 상태 확인.
- U02: 운영자가 대기 목록 조회 → 학생이 대기 취소 → 오래된 운영자 화면의 승인 거부(409)와 CANCELLED 유지.
- U03: 서버 종료·재실행 → 재로그인 → 신청 상태와 이력 유지.
- U04: 새 DB에서 행사 2에 alice·bob·charlie 순서로 신청 → manager2가 alice 승인 → alice 승인 취소(사유 입력) → bob 자동 승인, charlie 대기 유지 → alice와 bob의 변경 이력에서 원인 ID 연결 확인.
- U05: 새 DB에서 alice만 행사 2 신청·승인 → 승인 취소 → REVOKED, 승인 인원 0명, 응답 promoted=null 확인.

승인 취소는 담당 운영자 화면의 승인된 신청에서 수행합니다. 각 신청의 ‘변경 이력 보기’로 저장 결과를 확인합니다. 다른 탭의 변경은 자동 반영되지 않으므로 ‘최신 정보 새로고침’을 사용하세요.

## DB 초기화와 이전 코드에서의 전환

서버를 먼저 종료하고 아래 명령에서 `RESET`을 입력합니다. 신청·변경 이력을 지우고 초기 계정·행사를 다시 만듭니다.

```sh
npm run db:reset
```

이전 배포본 DB에는 REVOKED 상태와 변경 이력 스키마가 없습니다. 새 배포본에서는 기존 DB를 초기화하세요. 운영 데이터 마이그레이션은 이 과제 범위가 아닙니다.

선택 환경변수: PORT, DB_PATH, JWT_SECRET. 기본 실행에는 설정 파일이 필요 없습니다. 키 파일을 지우면 기존 토큰은 무효화됩니다.

## 파일 구조

- `src/application-service.js`: 학생 구현 TODO 4개와 트랜잭션
- `src/repository.js`: 조회·저장·이력 저장 도구
- `src/db.js`: SQLite 스키마·초기 데이터
- `src/auth.js`: JWT 인증
- `src/app.js`: 라우팅·형식 검사·조회 권한·오류 응답
- `src/server.js`: 로컬 서버
- `public/`: 승인 취소·이력 조회 포함 제공 화면
- `tests/`: 기반·필수·선택 심화 테스트
- `docs/API.md`: 상태·이력·입출력 계약

## 제출 전 작성할 내용

### 제출 정보
- 웹서비스설계 과제 2 · 202012174 김선재
- 저장소: https://github.com/sjlys0205/26_02_homework_transaction
- 보고서: [docs/report.pdf](docs/report.pdf) · 검증 증거: [docs/screenshot/](docs/screenshot/)

### 서비스 소개
CAMPUS 프로그램 신청 서비스(제공 화면 그대로 사용, Express 5 + node:sqlite + JWT)는 학생이 행사에 참가를 신청하고, 담당 운영자가 승인·승인 취소하는 서비스입니다.
이번 과제에서 신청·대기 취소·직접 승인·승인 취소 업무 규칙(R1~R8)을 구현했습니다.
승인 취소 시 같은 행사의 첫 대기자 1명을 자동 승급하고, 모든 상태 변경과 이력을 하나의 트랜잭션으로 저장합니다.
화면 주제와 API 계약은 제공된 그대로 유지했습니다.

### 설치·실행·초기화
| 단계 | 명령 |
|---|---|
| 버전 확인 | `node --version` (v24.x) |
| 설치 | `npm ci` |
| 테스트 | `npm test` / `npm run test:assignment` / `npm run test:advanced` |
| 실행 | `npm start` → http://127.0.0.1:3000 (종료: Ctrl+C) |
| DB 초기화 | 서버 종료 후 `npm run db:reset` → `RESET` 입력 |
| 증거 기록(선택) | `node scripts/evidence.js` → `docs/evidence/T01-T32.md` 생성 (임시 DB 사용) |

### 변경 파일 (제공 코드 기준 커밋 `49f9271` 대비)
| 파일 | 변경 내용 |
|---|---|
| `src/application-service.js` | TODO-01~04 구현. `inTransaction()`(BEGIN IMMEDIATE·COMMIT·ROLLBACK), `managedApplication()`(존재·담당자 검사), apply·cancel·approve·revoke |
| `src/repository.js` | `nextPending()` 추가만 함 (같은 행사 PENDING, `created_at ASC, id ASC`, `LIMIT 1`). 기존 함수는 수정하지 않음 |
| `docs/screenshot/` | 구현 전(B)·후(A) 테스트, 화면 검증(U), 새 폴더 재현(C), 증거 실행(E) 캡처 24장 |
| `scripts/evidence.js` | T01~T32 실측 증거 기록 보조 스크립트 추가 (서비스·테스트 코드 변경 없음) |
| `docs/evidence/T01-T32.md` | evidence.js 실행 결과 (요청 165건, 기대 상태 일치 165건) |
| `docs/report.pdf` | 보고서 |
| `README.md` | "제출 전 작성할 내용" 절만 작성 (나머지 제공 내용은 수정하지 않음) |

그 밖의 제공 파일(`app.js`, `db.js`, `auth.js`, `public/`, `tests/` 등)은 변경하지 않았습니다. 테스트 기대값도 변경하지 않았습니다.
`node_modules`, 생성 DB(`data/app.sqlite`)·서명 키(`data/jwt-secret.txt`), `.env`·JWT는 `.gitignore`로 제외해 제출하지 않았습니다.

### 구현 완료 여부
| 항목 | 결과 | 증거 |
|---|---|---|
| TODO-01 신청 / 02 대기 취소 / 03 직접 승인 / 04 승인 취소·자동 승급 | 완료 | `src/application-service.js` |
| `npm test` 기반 기능 | 4/4 통과 | `docs/screenshot/A01.jpg` |
| `npm run test:assignment` T01~T32 | 32/32 통과 | `docs/screenshot/A02.jpg` |
| `npm run test:advanced` (선택 심화) | 1/1 통과 | `docs/screenshot/A03.jpg` |
| 화면 검증 U01~U05 | 5/5 확인 | `docs/screenshot/U01.jpg`, `U02_1~U05_2.jpg` |
| 구현 전 기준 결과 | `npm test` 4/4, `test:assignment` 2/32, 화면 501 | `docs/screenshot/B01~B03.jpg` |
| 새 폴더 clone 재현 | 설치·테스트·실행·초기화 성공 | `docs/screenshot/C01~C05.jpg` |
| T01~T32 실측 증거 | 요청 165건 중 기대 상태 일치 165건 | `docs/evidence/T01-T32.md`, `docs/screenshot/E01.jpg` |

### 실행 환경
Windows 11 Home · Node.js v24.22.0 · npm 11.19.1 · 브라우저 Microsoft Edge

### 알려진 문제와 한계
- `npm start` 실행 시 "TODO 구현 전 501입니다" 문구는 제공 `src/server.js`의 고정 안내 문구입니다. 구현 여부와 무관해서 수정하지 않았습니다.
- 동시성 보호는 `BEGIN IMMEDIATE` 쓰기 잠금에 의존합니다. 같은 SQLite 파일을 공유하는 프로세스 사이에서만 유효합니다.
- 선택 심화 테스트 20회 통과는 모든 경쟁 상황이 없다는 증명이 아닙니다.
- 비교 실험: 일반 `BEGIN`으로 바꾸면 `[200, 500]`으로 실패했고, 서버 로그는 `database is locked`(SQLITE_BUSY)였습니다.

### AI 사용 요약
Claude Code(Claude Opus 5.5)를 사용했습니다. 상세 내용은 보고서의 "AI 활용과 참고 자료"에 있습니다.

| 사용 범위 | 본인이 직접 한 일 |
|---|---|
| 과제 문서 분석과 진행 계획 | 계획 확인, 일정 조정 |
| `application-service.js` TODO-01~04와 `repository.js` `nextPending()` 초안 작성 | 코드 이해, 주석 직접 작성·수정, 코드 및 주석 검토 결과 반영 |
| 코드와 테스트(T18~T20 등) 설명 | 모든 테스트 직접 실행·캡처 (B·A) |
| 일반 BEGIN과 BEGIN IMMEDIATE 비교 실험 | 화면 검증 U01~U05 직접 수행·캡처 |
| 캡처·주석 검토, README 초안 | 커밋 메시지 승인, 보고서 퇴고 진행 |
| `scripts/evidence.js` 증거 기록 스크립트 작성 | 직접 실행(165/165)·로그 검토 후 보고서 반영 |

## 참고 문서

- [Node.js SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Express API](https://expressjs.com/en/5x/api/)
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)
