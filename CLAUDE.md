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
