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

---

## 2026-06-26 2차 수정 (포스터 / AI 퀴즈 / 개봉예정 / 검색 / 퀴즈 전환)

### 버그 분석 결과 (전문 에이전트 검토)

| 버그 | 원인 | 수정 |
|---|---|---|
| S모드 포스터 미표시 | `q.posterKeyword` 필드 없음 (GAS 출력은 `movieTitle`) | `q.movieTitle \|\| q.posterKeyword` 로 변경, 다단계 매칭 |
| C모드 포스터 어두움 | `linear-gradient(rgba(0,0,0,0.85))` 85% 검정 오버레이 | 오버레이 제거, `url(...)` 직접 설정 |
| O모드 포스터 404 | placeholder.jpg가 HTTP 404 반환 | UPCOMING_MOVIES_DATABASE 전면 교체 + `img.onerror` fallback |
| R모드 포스터 일부 없음 | fake 영화들이 FILMO_POSTERS/DB에 없음 | 포함매칭(slice 4글자) 추가 |
| E모드 포스터 없음 | setupLinesQuizLayout에 포스터 DOM 접근 없음 | `#lines-movie-poster` HTML 추가 + JS 설정 코드 추가 |
| AI 퀴즈 생성 실패 | 30편 × 한국어 → URL 37KB (GAS 한도 초과) | 8편 + 필드 최소화 → URL ~4KB |
| 개봉예정작 없음 | DB에 2026-07-01 이후 데이터만 있었음 | kobis_movies_cache.json으로 교체 (15편, 2026-06-24~08-13) |
| 60일→21일 필터 | 60일 이내로 설정되어 있었음 | 21일로 변경 + 'YYYY-MM-DD' UTC 파싱 보정 |
| 검색 붙여쓰기 미동작 | `includes()` 공백 미정규화 | `replace(/\s+/g,'')` 정규화 후 비교 |
| O/R/E 클릭 후 미전환 | `setup*()` 함수가 `switchView()` 이전에 실행됨 | `switchView → activateQuizPanel → setup*()` 순서로 변경 |

### UPCOMING_MOVIES_DATABASE 관리 방법

서버의 `kobis_movies_cache.json`이 업데이트되면 index.html의 `UPCOMING_MOVIES_DATABASE`를 재생성해야 합니다.

```bash
# 서버에서 실행 (kobis_movies_updater.py 등으로 캐시 갱신 후)
python3 /home/kimminho/scripts/update_upcoming_db.py  # 향후 자동화 스크립트
```

현재는 수동으로 kobis_movies_cache.json의 upcoming 배열을 index.html에 반영합니다.

### AI 퀴즈 URL 크기 제한

GAS GET 파라미터 실용 한도: **4KB 이하**

- 현재 설정: 8편 샘플, 7개 필드만 직렬화 → ~3.8KB
- 한국어 1글자 = `encodeURIComponent` 후 9bytes (`%EB%A0%A0`)
- 영화 1편당 평균 ~480bytes 인코딩 후

**절대 하지 말 것**: `src.slice(0, 30)` + 전체 필드 JSON → URL 37KB 초과

### 포스터 표시 아키텍처

```
MOVIES_DATABASE[i].posterUrl  → TMDB URL (https://image.tmdb.org/t/p/w300/{hash}.jpg)
AI_QUIZ_MOVIES[i]             → posterUrl 없음 (movieTitle로 MOVIES_DATABASE 검색)
UPCOMING_MOVIES_DATABASE[i]   → posterUrl 있음 (kobis_cache에서 가져옴)
```

- TMDB URL은 실제 해시값이 있으면 정상 로드됨
- `placeholder.jpg`, `placeholder2.jpg`, `placeholder3.jpg` → 404, 절대 사용 금지
- 포스터 없는 경우 `var(--bg-secondary)` 배경 + material icon으로 대체

### 퀴즈 실행 흐름 (수정 후 올바른 순서)

```
startQuiz(type, subType, battleMode)
  1. 데이터 풀 생성 (movies 배열 구성)
  2. if(group) → _showGroupRegister → return
  3. switchView('quiz')           ← DOM 가시화 먼저
  4. activateQuizPanel(type)      ← 해당 패널 .active
  5. setup*QuizLayout()           ← DOM 가시화 후 초기화
  6. startTimer()
```

이전 버전은 5번이 1번 직후에 실행되어 DOM이 숨겨진 상태에서 backgroundImage 설정 → 브라우저 렌더링 지연으로 포스터 미표시 가능성.

---

## 2026-06-26 3차 수정 (제3자 테스트 기반 종합 수정)

### 테스트 결과 발견된 핵심 버그

| 우선순위 | 버그 | 원인 | 수정 |
|---|---|---|---|
| P0 | C모드 스텝 0/4/5 항상 오답 | MOVIES_DATABASE 99.4%가 openingSeats/VOD/OTT 비어있음 | 3단계(개봉일/개봉주/최종)로 축소 + AI_QUIZ_MOVIES 350편 풀로 교체 |
| P0 | E모드 초성퀴즈가 모든 화면에 노출 | quote-card/choseong-card에 CSS display:none 없음 | CSS에 초기 display:none 추가, JS에서 showQuote/showChoseong 토글 |
| P0 | E모드 subType='choseong'인데 명대사 표시 | `!hasChoseong && hasLines`가 subType 보다 우선 처리됨 | subType 우선 처리하는 조건 로직으로 전면 교체 |
| P0 | S모드 AI 퀴즈 항상 실패 | GAS URL 초과, Gemini 응답 불안정 | **CSV 로컬 퀴즈로 완전 대체 (AI/GAS 제거)** |
| P1 | O모드 첫 로드 시 포스터 미표시 | `img.onload` 내 `crop.style.background = ''`가 backgroundImage 초기화 | `background = ''` 줄 제거 |
| P1 | C모드 Enter 키로 제출 불가 | `form-challenge-quiz` HTML 폼 없음 | form 태그로 래핑 추가 |
| P2 | R모드 중복 클릭 시 XP 중복 | 오버레이 표시 중 재클릭 가능 | `_filmoGrading` 플래그로 3초간 차단 |
| P2 | S모드 마지막 문제 타임아웃 즉시 종료 | 마지막 문제에서 오버레이 없이 _finishSpecialAiQuiz() 직접 호출 | 정답 표시 오버레이 추가 후 종료 |

### S모드 로컬 퀴즈 구조 (AI 제거)

**데이터 소스:**
- `AI_QUIZ_MOVIES` (350편, CSV 기반): 개봉일/주/최종 관객수 범주 포함
- `SAME_DAY_QUIZ` (200건, CSV 기반): 동시개봉 정보

**문제 유형 (10문제):**
1. **동시개봉 퀴즈** (3문제): "다음 중 [영화A]와 같은 날 개봉한 영화는?" — 정답: 실제 같은 날 개봉, 오답: 다른 날짜 영화
2. **개봉일 관객수 범주** (3문제): "다음 중 [영화]의 개봉일 관객수 범주는?" — 4지선다
3. **개봉주 누적 관객수** (2문제): "개봉 첫 주 누적 관객수는?" — 4지선다
4. **감독 필모그래피** (2문제): "다음 중 [감독]의 작품이 아닌 것은?" — 4지선다

**반복 방지:** `sessionStorage`에 당일 사용한 영화 목록 저장, 다음 퀴즈에서 미사용 영화 우선 샘플링

### C모드 3단계 퀴즈 구조

**풀:** `AI_QUIZ_MOVIES` 350편 (openingDayCat + openingWeekCat + finalCat 모두 있는 영화만)  
**단계:**
1. Step 1: 개봉일 관객수 범주 (1~5만명/5~10만명/11~20만명/21만명 이상)
2. Step 2: 개봉 첫 주 누적 관객수 (10만명 이하/11~50만명/51~100만명/101만명 이상)
3. Step 3: 최종 누적 관객수 (11~50만명/51~100만명/101만명 이상/201~300만명/301~500만명/501만명 이상)

**성공 기준:** 3문제 중 2개 이상 (기존 6문제 중 4개에서 변경)

### E모드 초성/명대사 토글 로직

```javascript
const showQuote   = (subType === 'quote' && hasLines) ||
                    (subType !== 'choseong' && hasLines && !hasChoseong) ||
                    (subType === null && hasLines);
const showChoseong = (subType === 'choseong' && hasChoseong) ||
                     (subType !== 'quote' && hasChoseong && !hasLines) ||
                     (subType === null && hasChoseong && !hasLines);
```

MOVIES_DATABASE에 famousLines=0개, choseong=26개만 있으므로 현재는 초성 퀴즈만 사용 가능.
famousLines 데이터 추가 시 명대사 퀴즈도 자동으로 활성화됨.

### 데이터 갱신 방법

**SAME_DAY_QUIZ 재생성** (past_boxoffice.csv 갱신 시):
```python
# 서버에서 실행
python3 << 'EOF'
import csv, json
from collections import defaultdict
# ... (gen_same_day_quiz.py 스크립트 작성 필요)
EOF
```

**AI_QUIZ_MOVIES 재생성** (past_boxoffice.csv + movie_details.csv 갱신 시):
```bash
# /tmp/opencode/ai_quiz_movies.js 재생성 후 index.html에 반영
```

---

## 2026-07-04 4차 수정 (OpenCode — 실제 브라우저 재현 테스트 기반 "퀴즈 미실행" 버그 근본 해결)

### 배경

"섹션에 들어가면 퀴즈가 실행되지 않는 경우가 많다"는 제보를 받고, 코드 추측이 아니라 Playwright로 실제 크롬 브라우저를 띄워 로컬 서버 + 실제 GitHub Pages 배포본 양쪽에서 S/C/O/R/E 5개 섹션을 전부 실사용자처럼 클릭하며 재현·검증함. 이후 5개 섹션 각각 5라운드를 끝까지 정답 제출하여 `view-finale`까지 도달하는 end-to-end 회귀 테스트를 작성해 수정 전/후를 비교 확인.

### BUG-A ★★★ E모드(명대사/초성) 진입 시 항상 빈 화면 — 어떤 브라우저에서도 100% 재현되는 치명적 버그

- **원인 1 (CSS 우선순위 충돌)**: `#quiz-panel-lines`는 `class="quiz-mode-panel flex-center-col"` 두 클래스를 가짐.
  - `.quiz-mode-panel { display:none }` / `.quiz-mode-panel.active { display:flex }` — 활성 패널만 보여야 함
  - 그런데 `.flex-center-col { display:flex; ... }` 규칙이 CSS 파일 후반부에 별도로 선언되어 있어, **동일 specificity(클래스 1개)인 두 규칙이 소스 순서로 충돌** → `.flex-center-col`이 항상 이겨서 **E모드 패널이 `.active` 클래스 여부와 무관하게 항상 화면에 렌더링됨**.
  - 실측: S/C/O/R 어떤 화면으로 들어가도 하단에 E모드의 "영화 제목을 입력하세요" 입력창과 "정답 확인하기" 버튼이 항상 겹쳐서 표시되고 있었음 (스크린샷으로 확인).
- **원인 2 (display 토글 로직 오류)**: `setupLinesQuizLayout()`에서 초성/명대사 카드를 보여줄 때 `quoteCard.style.display = ''` 로 인라인 스타일을 **제거**하는 방식을 사용. 이는 "브라우저 기본값 복원"이 아니라 "CSS 클래스 규칙 그대로 적용"을 의미하는데, `.choseong-card`/`.quote-card` 클래스 자체에 `display:none`이 박혀 있어서 **`style.display=''`로는 절대 보이지 않음** (원래 없던 것이 아니라 CSS 클래스의 `display:none`이 그대로 유지됨). 결과적으로 E모드는 초성 힌트도 명대사도 텍스트가 전혀 렌더링되지 않고, 사용자는 빈 입력창만 보게 됨.
- **수정**:
  1. `.quiz-mode-panel` / `.quiz-mode-panel.active`에 `!important` 추가하여 다른 유틸리티 클래스보다 항상 우선하도록 CSS 우선순위 문제를 원천 차단.
  2. `setupLinesQuizLayout()`의 `style.display = ''` → `style.display = 'block'`로 명시적 값 지정 (3곳: quote 표시, choseong 표시, fallback choseong 표시).
- **검증**: 수정 전 스크린샷에서는 초성/명대사 카드가 완전히 비어있었고, 다른 모든 모드(S/C/O/R) 화면 하단에 E모드 입력창이 항상 겹쳐 보였음. 수정 후 재현 시 초성 힌트("ㅂㅈㄷㅅ4")와 명대사("저는 이 아파트가...")가 정상 렌더링되고, 다른 모드 화면에서 E모드 leak이 완전히 사라짐. E모드 5라운드 전체 정답 제출 → 결과 화면(`view-finale`, 5/5 라운드 성공) 도달 확인.

### BUG-B ★★★ R모드(필모그래피) — 두 번째 문제부터 정답을 클릭해도 100% 무응답

- **원인**: `gradeFilmoQuiz()`에 중복 클릭 방지용 `this._filmoGrading` 락이 있고 `setTimeout(() => { this._filmoGrading = false }, 3000)`으로 3초 후 자동 해제되도록 되어 있음. 그런데 오답/정답 오버레이를 확인하고 "다음 문제" 버튼을 눌러 `nextRound()` → `setupFilmoQuizLayout()`이 호출되는 시점이 **락이 걸린 지 3초가 지나지 않은 경우가 대부분**이어서, 다음 문제 화면이 뜬 직후 사용자가 답을 클릭해도 `if (this._filmoGrading) return;`에서 조용히 무시됨. 사용자 입장에서는 "선택지를 클릭해도 아무 반응이 없다 = 퀴즈가 멈췄다"로 보임.
- **수정**: `setupFilmoQuizLayout()` 시작 부분에 `this._filmoGrading = false;`를 추가하여 매 라운드 시작 시 락을 명시적으로 해제.
- **검증**: 수정 전에는 라운드 2에서 정답 클릭 시 오버레이가 전혀 뜨지 않고 멈춰 있었음(Playwright 클릭 타임아웃으로 재현). 수정 후 5라운드 전체 연속 정답 클릭 → 매 라운드 오버레이 정상 표시 → `view-finale` 도달 확인.

### BUG-C ★★ C모드(Special/Score) 예측 결과 안내 문구 오류

- **원인**: 3단계(개봉일/개봉주/최종)로 리팩터링된 이후에도 결과 안내 문구가 `"6가지 예측 문항 중 N개를 적중"`으로 남아있어 실제 문항 수(3개)와 불일치. 기능 오류는 아니지만 사용자에게 혼란을 줌.
- **수정**: `"6가지"` → `"3가지"`로 문구 정정.

### BUG-D ★★★ (서비스 운영 리스크) 개인정보 동의 문구가 실제 동작과 불일치

- **원인**: 회원가입 화면의 개인정보 동의 문구가 "수집된 정보는 로컬 브라우저 저장소에만 안전하게 기록됩니다"라고 안내하지만, 실제로는 `saveQuizHistory()`에서 매 퀴즈 종료 시 닉네임·이메일·점수·정확도 등을 `SCORE_SHEET_WEBHOOK_URL`(GAS)을 통해 운영자의 구글 시트로도 함께 전송하고 있음. 타인에게 서비스를 오픈할 경우 **사실과 다른 개인정보 처리 안내**는 법적 리스크가 될 수 있음.
- **수정**: 문구를 "프로필 정보는 브라우저 저장소에 보관되며, 퀴즈 결과(닉네임·이메일·점수 등)는 통계 집계를 위해 운영자의 구글 시트에도 함께 저장됩니다."로 정정하여 실제 데이터 흐름과 일치시킴.

### BUG-E ★ OTP 재전송 스팸 남용 방지 누락

- **원인**: "코드 재전송" 버튼에 어떤 쿨다운도 없어, 사용자가 빠르게 반복 클릭하면 GAS `MailApp.sendEmail()`이 그만큼 반복 호출됨. Google Workspace/개인 계정의 `MailApp` 일일 발송 한도(계정 유형에 따라 100~1,500건/일)를 다른 사용자가 악의적으로 소진시킬 수 있음.
- **수정**: `sendOtp()`에 클라이언트 측 30초 쿨다운(`_otpLastSentAt`) 추가. 30초 이내 재요청 시 남은 대기 시간을 토스트로 안내하고 발송을 차단.

### 회귀 테스트 방법 (재발 방지용)

Playwright로 5개 섹션을 실제 클릭 흐름으로 5라운드씩 끝까지 진행시켜 `view-finale` 도달 여부와 콘솔 에러 유무를 확인하는 스크립트를 작성함 (`/tmp/opencode/pwtest/regression_all.py`, 서버 로컬 보관 — 필요 시 재생성 가능). 향후 index.html을 수정할 때마다 아래 항목을 반드시 재확인할 것:

1. 로그인 우회(`localStorage.setItem('cinemaster_user', ...)`) 후 대시보드 5개 모드 카드 → "더 보기" → 개인전 진입까지 실제 클릭으로 도달 가능한지
2. S/O/E 모드: 입력창에 정답 입력 → 제출 → 오버레이 확인 → "다음 문제" 클릭이 5라운드 연속 정상 작동하는지
3. R모드: 4지선다 카드 클릭이 **모든 라운드**에서 반응하는지 (2번째 라운드부터 무반응이면 락 버그 재발 의심)
4. C모드: 라디오 선택 → "답안 제출 & 다음 질문" 클릭이 3단계 모두 정상 작동하고 결과 문구 숫자가 실제 문항 수와 일치하는지
5. 브라우저 개발자 콘솔에 JS 에러가 전혀 없는지 (`pageerror`, `console.error` 둘 다 확인)

### 향후 개선 권장 (기능 버그는 아니므로 보류)

- C모드 상단 스텝 인디케이터(`#score-quiz-steps-bar`)가 6개 dot(1~6)으로 표시되지만 실제로는 3단계(2/3/4번째 dot)만 사용됨 — dot 개수를 3개로 줄이거나 사용하지 않는 dot을 숨기면 UX가 더 명확해짐.
- `startSpecificQuiz()`가 호출하는 `setupScoreQuizLayout()`과, 별도로 존재하는 `setupChallengeQuizLayout()`(YYMMDD 날짜 직접 입력 방식)이 서로 다른 UI인데 실제 UI 진입점(`showReleasedSearch` → `startSpecificQuiz`)에서는 후자가 전혀 호출되지 않는 죽은 코드 상태. 두 UI 중 하나로 통일하거나, 날짜 맞추기 방식을 실제로 사용할 계획이면 진입 경로를 연결해야 함.

---

## 2026-07-04 5차 수정 (OpenCode — 개봉예정작 필터 기간 조정, R모드 인물 풀 대폭 확장, O모드 포스터 확대)

### 요청 사항 (사용자 3건)

1. 개봉예정작 퀴즈(Challenge → 개봉예정작)를 앱 실행 시점 기준 **1개월 이내** 개봉작 중 **포스터가 있는 것**만 반영
2. 필모그래피(R모드) 질문이 특정 소수 인물에게만 나옴 — 퀴즈 가능한 인물 수를 최대화
3. 포스터 조각 맞추기(O모드)에서 보여지는 포스터 조각을 **15% 확대**

### 1) 개봉예정작 필터 (`showUpcomingList()`)

- **기존**: KST 기준 오늘~21일 이내로 하드코딩, `posterUrl` 유무 체크 없음(다만 `UPCOMING_MOVIES_DATABASE` 15편이 모두 포스터를 갖고 있어 실질적 영향은 없었음).
- **수정**: 21일 → **1개월(`setMonth(+1)`)**로 변경, 필터 조건에 `m.posterUrl` 존재 여부를 명시적으로 추가(`if (!m.releaseDate || !m.posterUrl) return false;`). 빈 결과 안내 문구도 "21일 내" → "1개월 내"로 수정.
- **검증**: 2026-07-04 기준 실행 결과 F1(7/9)·슈퍼맨(7/16)·미션 임파서블: 파이널 레코닝(7/23)·쥬라기 월드 리버스(7/30) 4편이 정상 노출되고, 1개월을 초과하는 범죄도시5(8/13)는 제외됨을 실제 클릭 테스트로 확인.
- 참고: 이 필터는 `showUpcomingList()`(Challenge 개봉예정작 리스트 화면) 전용이며, O/C모드의 데이터 풀 구성에 쓰이는 별도의 `UPCOMING_MOVIES_DATABASE.filter(m => m.posterUrl)` 로직(포스터만 체크, 날짜 무관)은 이번 요청 범위가 아니라 그대로 유지함.

### 2) R모드(필모그래피) 인물 풀 확장 — 감독 5명·배우 6명 → 감독 110명·배우 395명

- **원인**: `FILMOGRAPHIES` 상수가 감독 5명, 배우 6명으로 수동 하드코딩되어 있어 퀴즈를 반복하면 같은 인물이 계속 나올 수밖에 없는 구조였음.
- **재생성 방법**: 서버에 이미 있는 `MOVIES_DATABASE`(1,773편, director/cast 필드 포함)를 파싱해 인물별 필모그래피를 자동 집계.
  - 감독: 연출작 4편 이상 & 포스터 보유 영화만 필터링 → 110명 확보
  - 배우: 출연작 5편 이상 & 포스터 보유 영화만 필터링 → 395명 확보
  - 각 인물마다 실제 대표작 중 랜덤 6편(`movies`)과, **다른 인물의 필모에서만 가져온** 오답 후보 6편(`fake`, 본인 작품과 절대 중복되지 않도록 제외 처리)을 생성
  - 인물명 정제 필터(`valid_name`)로 숫자·특수문자·2글자 미만 이름(파싱 노이즈) 제거
- **검증**:
  - `node -e` 문법 검증으로 `FILMOGRAPHIES.directors.length === 110`, `.actors.length === 395` 확인
  - movies+fake 전체 5,841건 전수 검사 → **포스터 매칭 실패 0건** (`FILMO_POSTERS` → `MOVIES_DATABASE` 정확매칭 → 포함매칭 3단계 fallback 그대로 재사용)
  - Playwright로 감독 모드 10회 연속 진입 시 매번 다른 인물(예: 고어 버빈스키, 박찬욱, 존 파브로, 송해성, 제임스 건 등)이 등장함을 확인
  - R모드 5라운드 전체 정답 클릭 → `view-finale` 정상 도달, 신규 인물(예: "배종옥" 배우)도 포스터 4장 정상 렌더링되는 것을 스크린샷으로 확인
- **데이터 갱신 방법(향후 참고)**: `MOVIES_DATABASE`가 갱신되면 동일한 파싱 스크립트를 재실행해 `FILMOGRAPHIES`를 재생성해야 함. 스크립트 로직 요약:
  ```
  1. MOVIES_DATABASE에서 (title, director, cast[], posterUrl) 추출
  2. 감독은 콤마/슬래시로 분리 후 인물별로 그룹화, 배우는 cast 배열 그대로 그룹화
  3. 포스터 있는 영화만 남기고, 감독은 4편+, 배우는 5편+ 인 인물만 채택
  4. 각 인물마다 movies 6개(랜덤), fake 6개(다른 인물 필모에서 중복 없이 랜덤) 생성
  5. FILMOGRAPHIES.directors / .actors 배열로 JS 코드 생성 후 index.html의 기존 상수 블록을 정규식으로 치환
  ```

### 3) O모드(포스터 조각 맞추기) 조각 크기 15% 확대

- **수정**: `setupOrdinaryQuizLayout()`에 `ZOOM = 1.15` 상수를 추가해 `stage`(원형 뷰포트)와 `crop`(배경 이미지) 크기·배경 위치 계산에 일괄 곱함. 5×5 분할·랜덤 위치 선택 로직 자체는 변경 없음(잘라내는 영역 비율은 동일, 화면에 보이는 크기만 확대).
  - 기존: 원형 뷰포트 120px (`cellW * 2`)
  - 변경: 원형 뷰포트 138px (`cellW * 2 * 1.15`)
- **검증**: Playwright로 `#ordinary-poster-stage`의 실제 렌더링 크기를 측정해 120px → 138px(정확히 15% 증가)로 변경된 것을 확인, 스크린샷으로도 조각이 이전보다 크게 보이는 것을 확인.

### 종합 회귀 테스트

이번 수정 후에도 기존 회귀 테스트 스위트(S/C/O/R/E 각 5라운드 끝까지 진행 → `view-finale` 도달)를 재실행해 전 항목 통과 및 JS 콘솔 에러 0건을 확인함(2회 연속 실행으로 안정성 재확인).

---

## 2026-07-04 6차 수정 (OpenCode — 개봉예정작을 KOBIS 실시간 데이터로 완전 자동화)

### 배경

5차 수정에서 개봉예정작 필터를 "1개월 이내"로 바꿨지만, 그 시점까지도 `UPCOMING_MOVIES_DATABASE`는 **과거에 한 번 수집해 하드코딩해둔 15편짜리 정적 데이터**였다. 사용자가 "실제로 한국에서 개봉예정인 영화들만, 실행 시점 기준 1개월 이내로" 요청함에 따라, 매주 KOBIS(영진위) API를 실시간으로 조회해 자동 갱신하는 배치 스크립트를 신규 구축함. 실시간 조회는 서버 부담이 있으므로 사용자와 상의해 **주 1회, 매주 일요일 23:59 KST**에 실행하도록 확정.

### 신규 스크립트: `/home/kimminho/update_upcoming_movies.py`

- **데이터 흐름**: KOBIS `searchMovieList` API로 "실행 시점 KST 기준 오늘 ~ +1개월" 개봉작 후보를 페이지네이션으로 전량 수집 → 각 후보를 KOBIS `searchMovieInfo`로 감독/출연진 조회 → TMDB로 포스터 검색 → **감독 정보 없음 또는 포스터 없음인 영화는 제외** → 최대 15편까지 확정.
- **기존 `kobis_movies_updater.py`와의 관계**: 로직(엔드포인트, 필드 매핑, 감독/포스터 필터링 기준)은 기존 스크립트를 그대로 재사용했으나, 다음 차이점이 있음:
  1. 기존 스크립트는 "향후 60일" 고정 + 개봉작(released)까지 함께 수집해 `movies_data.js` 전체를 재생성하는 범용 스크립트였음. 신규 스크립트는 **개봉예정작만, 실행 시점 기준 정확히 1개월**만 다루는 전용 스크립트로 분리.
  2. 기존 스크립트는 KOBIS/TMDB 요청 타임아웃이 10초로 짧아 응답이 느릴 때 자주 실패했음(실제로 이번 작업 중 재현: page 2~4에서 반복 타임아웃). 신규 스크립트는 **타임아웃 30초 + 최대 3회 재시도** 로직을 추가해 안정성을 높임.
  3. 결과를 `index.html`의 `UPCOMING_MOVIES_DATABASE` 상수 블록에 정규식으로 직접 치환하고, 결과가 0건이면 **안전을 위해 index.html을 건드리지 않고 종료**하도록 가드 추가(빈 데이터로 앱이 깨지는 것을 방지).
  4. 실행 후 `/tmp/opencode/score` 저장소에서 자동으로 `git add/commit/push`까지 수행해 GitHub Pages가 재배포되도록 함(변경 사항이 없으면 커밋 스킵).
- **로그/상태 파일**: `/home/kimminho/update_upcoming_movies.log`(누적 로그), `/home/kimminho/update_upcoming_movies_state.json`(최근 실행 결과 스냅샷).

### 실제 실행 검증 (2026-07-04 20:53~20:58 KST, 수동 1회 실행)

- KOBIS API에서 실행 시점(2026-07-04) 기준 2026-08-04까지의 후보 16편을 페이지네이션(7페이지)으로 전량 수집.
- 감독 미정 2편(예스! 유 캔, 호컴), 포스터 없음 1편(블리치 천년혈전 편 : 화진담) 제외 후 **최종 13편** 확정: 희망의 발견,알래스카에서 / 모아나 / 시크릿 에이전트 / 키퍼 / 미명 / 하나 코리아 / 다윗 / 미니언즈 & 몬스터즈 / 호프 / 파리의 사생활 / 가능주의자 / 지느러미 / 드림 애니멀즈: 더무비.
- `index.html` 갱신(1,176,019자) 후 자동 커밋(`data: 개봉예정작 자동 갱신 (2026-07-04 20:58 KST, 13편, 1개월 이내)`) + push 성공.
- Playwright로 실제 화면 재검증: Challenge → 개봉예정작 → 개인전 진입 시 위 13편이 정확히 리스트에 노출되고, 첫 영화("희망의 발견, 알래스카에서") 클릭 시 실제 포스터·감독명과 함께 퀴즈가 정상 시작됨을 확인(콘솔 에러 0건).

### 배포 자동화 (crontab 등록)

```
59 14 * * 0 /usr/bin/python3 /home/kimminho/update_upcoming_movies.py >> /home/kimminho/update_upcoming_movies_cron.log 2>&1
```
- 서버(UTC) 기준 **매주 일요일 14:59** = **KST 매주 일요일 23:59** (사용자 확정 시각). 일~월요일 자정을 넘기지 않는 시각이라 요일 필드(`0`=일요일)를 그대로 사용해도 KST 요일과 정확히 일치함.
- 다음 실행부터는 실행 시점 기준으로 다시 "1개월 이내"가 재계산되므로, 매주 최신 개봉예정작으로 자동 롤링됨.

### 참고: 개봉예정작 데이터의 3가지 계층 구분 (혼동 주의)

| 데이터 | 용도 | 실시간성 |
|---|---|---|
| `UPCOMING_MOVIES_DATABASE` (index.html) | Challenge "개봉예정작" 리스트 화면(`showUpcomingList()`)에 실제 노출되는 데이터 | **이번 자동화로 매주 갱신됨** |
| `/home/kimminho/kobis_movies_cache.json` | 서버에 남아있는 과거 스냅샷 캐시(기존 `kobis_movies_updater.py`가 생성) | 이번 자동화와 무관, 갱신되지 않음(레거시) |
| O/C모드의 `UPCOMING_MOVIES_DATABASE.filter(m => m.posterUrl)` 재사용 로직 | 포스터 조각 맞추기 등 다른 모드의 데이터 풀 | 위 `UPCOMING_MOVIES_DATABASE` 자체가 갱신되므로 자동으로 최신화됨 |

### 향후 참고사항

- KOBIS/TMDB API 응답이 간헐적으로 느려 전체 실행에 4~5분 정도 걸릴 수 있음(정상). 크론은 백그라운드로 도니 문제 없음.
- 만약 어느 주에 "감독 미정 + 포스터 없음"인 영화가 유독 많아 최종 후보가 0편이 되면, 스크립트가 `index.html`을 건드리지 않고 조용히 종료하므로 그 주는 이전 주 데이터가 유지됨(로그에서 확인 가능).
- KOBIS API 키/TMDB API 키는 `/home/kimminho/config.py`에 있음(기존 `kobis_movies_updater.py`와 동일한 키 재사용, 별도 키 발급 불필요).



