# score 앱 — 개발 맥락 기록

## 개요

**score**는 영화 흥행 퀴즈 웹앱(SPA)입니다. `index.html` 단일 파일에 HTML/CSS/JS가 모두 포함되어 있으며, Google Apps Script(GAS) 백엔드와 연동됩니다.

- **GitHub**: https://github.com/kimminho-raondasom/score
- **배포**: GitHub Pages (`main` 브랜치 `index.html` 직접 서빙)
- **백엔드**: Google Apps Script 웹앱 (`SCORE_SHEET_WEBHOOK_URL`)

---

## 앱 구조

### 5개 퀴즈 섹션 (S·C·O·R·E)

| 섹션 | 명칭 | 내용 | 퀴즈 패널 ID |
|---|---|---|---|
| S | Special | AI 생성 4지선다 (개봉일스코어/필모) | `quiz-panel-score` |
| C | Challenge | 개봉일 6자리(YYMMDD) 맞추기 | `quiz-panel-challenge` |
| O | Ordinary | 포스터 조각 → 영화 제목 맞추기 | `quiz-panel-ordinary` |
| R | Regular | 감독/배우 필모그래피 4지선다 | `quiz-panel-filmo` |
| E | Easy | 명대사/초성 → 영화 제목 | `quiz-panel-lines` |

### 데이터 상수 (index.html 내 `<script>` 블록)

| 상수 | 설명 | 크기 |
|---|---|---|
| `MOVIES_DATABASE` | 개봉작 (~1,750편, posterUrl 포함) | ~900KB |
| `UPCOMING_MOVIES_DATABASE` | 개봉예정작 (~10편) | 소량 |
| `FILMOGRAPHIES` | 감독 5명 + 배우 6명 필모그래피 | 소량 |
| `GAME_OPTIONS` | C모드 선택지 범주 | 소량 |
| `AI_QUIZ_MOVIES` | S모드 AI 퀴즈용 실측 흥행 데이터 (350편) | ~110KB |

### 서버 데이터 (GCP `/home/kimminho/`)

| 파일 | 설명 |
|---|---|
| `past_boxoffice.csv` | 2004~2026 일별 박스오피스 (82,082행) |
| `movie_details.csv` | 영화 상세정보 감독/배우/장르 (9,018편) |
| `kobis_movies_cache.json` | 최근 개봉작 20편 + 개봉예정작 10편 (JSON) |

---

## 주요 버그 수정 이력

### 2026-06-26 (OpenCode 종합 수정)

#### BUG-01 ★★★ C모드 스코어 예측 — 항상 오답 처리
- **원인**: `GAME_OPTIONS` 선택지 텍스트가 `MOVIES_DATABASE` 실제 값과 전혀 불일치
  - DB 실제값: `"11~50만명"`, `"51~100만명"`, `"1~5만명"`, `"5~10만명"`
  - 구 GAME_OPTIONS: `"11~15만명"`, `"51~75만명"`, `"2~3만명"`, `"8~10만명"` (세분화된 다른 값)
- **수정**: `GAME_OPTIONS.openingDayScore`, `openingWeekScore`, `finalScore`를 실제 DB 범주값으로 교체
  ```js
  openingDayScore: ["1~5만명","5~10만명","11~20만명","21만명 이상"],
  openingWeekScore: ["10만명 이하","11~50만명","51~100만명","101만명 이상"],
  finalScore: ["11~50만명","51~100만명","101만명 이상","201~300만명","301~500만명","501만명 이상"],
  ```

#### BUG-02 ★★★ MOVIES_DATABASE 중복 ID 19개
- **원인**: 동일 id가 두 번 선언된 항목이 19개 존재 (유니코드 이스케이프 버전 + 한글 버전)
- **수정**: `module.exports` 블록 직후에 런타임 중복 제거 IIFE 추가
  ```js
  (function() {
    const seen = new Set();
    for (let i = MOVIES_DATABASE.length - 1; i >= 0; i--) {
      if (seen.has(MOVIES_DATABASE[i].id)) MOVIES_DATABASE.splice(i, 1);
      else seen.add(MOVIES_DATABASE[i].id);
    }
  })();
  ```

#### BUG-03 ★★ S모드(Special AI 퀴즈) — CORS 오류로 항상 실패 + 동일 문제 반복
- **원인 1**: `fetch(GAS_URL, {method:'POST', headers:{'Content-Type':'application/json'}})` — GAS는 CORS preflight 미지원으로 항상 실패
- **원인 2**: GAS에서 항상 같은 시트 전체를 반환하고 랜덤화가 부족해 동일 문제 생성
- **수정**:
  1. 서버 CSV(`past_boxoffice.csv` + `movie_details.csv`)에서 2010년 이후 총관객 10만 이상, 감독 정보 있는 350편을 추출해 `AI_QUIZ_MOVIES` 상수로 `index.html`에 내장
  2. `_generateAiQuestions()` 를 GAS JSONP 방식(`GET ?action=geminiGenerate&callback=fn&prompt=...`)으로 전면 교체
  3. `sessionStorage`로 이미 사용한 영화 추적 → 매 퀴즈마다 다른 30편 샘플 선택
  4. 프롬프트를 **개봉일 관객수 / 개봉주 관객수 / 필모그래피** 위주로 재설계 (유형 명시)

#### BUG-04 ★★ O모드(Ordinary 포스터) — posterUrl 없는 영화에서 완전 중단
- **원인**: `if (!movie || !movie.posterUrl) return;` — 퀴즈가 멈추고 아무 일도 안 일어남
- **수정**: posterUrl 없는 영화를 최대 5번까지 건너뛰고, 모두 없으면 `finishQuiz()` 호출

#### BUG-05 ★★ Challenge→Score 전환 시 제출 버튼 사라짐
- **원인**: `setupChallengeQuizLayout()`이 `btn-next-step`을 `display:none`으로 숨기고 `setupScoreQuizLayout()`에서 복원 안 함
- **수정**: `setupScoreQuizLayout()` 첫 줄에 복원 코드 추가
  ```js
  const nextStepBtn = document.getElementById('btn-next-step');
  if (nextStepBtn) nextStepBtn.style.display = '';
  ```
  동시에 `movie.releaseDate`, `movie.director`, `movie.cast` 옵셔널 체이닝 처리 추가

#### BUG-06 ★★ 단체전 닉네임 영구 덮어쓰기
- **원인**: `submitGroupRegistration()`에서 `this.currentUser.nickname`을 참가자 이름으로 직접 덮어쓰고 `saveProfile()` 호출
- **수정**: `_savedGroupNickname` / `_savedGroupRealName`에 원래 닉네임 백업 → `endGroupSession()` / `_cancelGroupRegister()`에서 복원

---

## 아키텍처 주의사항

### GAS CORS 제약
- GAS 웹앱은 `OPTIONS` preflight를 처리하지 않음
- **모든 GAS 통신은 JSONP (`GET ?callback=fn`) 방식만 사용**
- POST/JSON fetch는 `mode:'no-cors'`라도 Content-Type 헤더가 무시되어 body 전달 불가

### AI 퀴즈 데이터 흐름
```
index.html 내 AI_QUIZ_MOVIES (350편 실측 데이터)
  → _generateAiQuestions() 에서 30편 랜덤 샘플
  → JSONP로 GAS에 prompt 전달
  → GAS에서 Gemini API 호출 (GEMINI_API_KEY는 GAS 서버에만 존재)
  → JSONP callback으로 JSON 문제 10개 반환
  → _renderSpecialAiQuestion() 으로 UI 렌더링
```

### MOVIES_DATABASE 범주값
실제 DB에 저장된 정확한 범주 텍스트 (GAME_OPTIONS과 반드시 일치해야 함):

| 필드 | 유효한 범주값 |
|---|---|
| `openingDayScore` | `"1~5만명"`, `"5~10만명"`, `"11~20만명"`, `"21만명 이상"` |
| `openingWeekScore` | `"10만명 이하"`, `"11~50만명"`, `"51~100만명"`, `"101만명 이상"` |
| `finalScore` | `"11~50만명"`, `"51~100만명"`, `"101만명 이상"`, `"201~300만명"`, `"301~500만명"`, `"501만명 이상"` |
| `openingSeats` | `"5만석 이하"` ~ `"71만석 이상"` (8단계) |

---

## 향후 개선 필요 사항

- [ ] `AI_QUIZ_MOVIES`는 서버 CSV 갱신 시 재생성 필요 (`python3 /home/kimminho/scripts/gen_ai_quiz_data.py` 식으로 자동화 권장)
- [ ] OTP 보안: 현재 클라이언트에서 코드 생성 후 메모리 보관 → GAS 서버에서 생성/검증으로 개선 필요
- [ ] 레벨업 알림: `addXp()`의 레벨 계산식이 `tiersSpecs.minXp`와 불일치 — `getTierSpecByXp()`로 교체 필요
- [ ] `FAMOUS_CHARACTERS` 닉네임 생성에 `NICKNAME_MODIFIERS` 조합 미구현 (dead code)
- [ ] S모드 AI 퀴즈: GAS `geminiGenerate` GET 요청 시 URL 길이 제한(~8KB) 주의 — prompt가 길어지면 truncate 필요

---

## GAS 웹앱 설정

- **스크립트 파일**: `score_sheets_appscript.gs`
- **배포 URL**: `SCORE_SHEET_WEBHOOK_URL` (index.html 내 상수)
- **Gemini API 키**: GAS 스크립트 내 `GEMINI_API_KEY` 상수 (클라이언트 비노출)
- **사용 시트**: 별도 Google Spreadsheet (`DATA_SS_ID`), 영화 상세 + 북미극장 탭
- **재배포 필요 조건**: GAS 코드 변경 시 항상 새 버전으로 재배포 (URL은 동일하게 유지)
