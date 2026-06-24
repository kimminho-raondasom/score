/**
 * score 앱 — 퀴즈 기록 수신 & Google Sheets 저장 + 이메일 OTP 인증 + Gemini 프록시
 *
 * [설치 방법]
 * 1. Google Sheets에서 새 시트를 만듭니다.
 * 2. 상단 메뉴 → 확장 프로그램 → Apps Script 열기
 * 3. 이 코드를 붙여넣고 저장합니다.
 * 4. 배포 → 새 배포 → 웹 앱으로 배포
 *    - 실행 계정: 나
 *    - 액세스 권한: 모든 사용자 (익명 포함)
 * 5. 배포 URL을 복사해서 index.html의 SCORE_SHEET_WEBHOOK_URL 에 붙여넣습니다.
 *
 * [엔드포인트]
 * POST { action: 'sendOtp', email, code }        → OTP 이메일 발송
 * POST { action: 'geminiGenerate', prompt, ... }  → Gemini AI 프록시 (키 서버사이드 보관)
 * GET  ?action=getSheetData&callback=fn           → 시트 데이터 JSONP 반환
 */

const SHEET_NAME = 'quiz_records';

// ── Gemini API 키 (서버사이드에만 존재 — 클라이언트에 절대 노출되지 않음) ──
const GEMINI_API_KEY = 'AIzaSyBrs35Gz-FRc9Cuj9MMpjusJcd7wyx8Yb4';
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;

// ── 권한 승인용 테스트 함수 ──────────────────────────────────────────────
// Apps Script 편집기에서 이 함수를 선택 후 ▶ 실행하면
// UrlFetchApp 권한 팝업이 뜹니다 → 허용 클릭
function testGeminiProxy() {
  try {
    const res = UrlFetchApp.fetch(GEMINI_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ parts: [{ text: '안녕' }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
      }),
      muteHttpExceptions: true
    });
    const result = JSON.parse(res.getContentText());
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '(응답 없음)';
    Logger.log('✅ Gemini 프록시 정상: ' + text);
    return '✅ 정상: ' + text;
  } catch (e) {
    Logger.log('❌ 오류: ' + e.message);
    return '❌ 오류: ' + e.message;
  }
}

// ── JSONP / JSON 응답 헬퍼 ───────────────────────────────────────────────
function _respond(data, callback) {
  const json = JSON.stringify(data);
  if (callback && /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(callback)) {
    // JSONP: 안전한 콜백 이름만 허용 (정규식으로 XSS 방지)
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ── Gemini AI 프록시 ───────────────────────────────────────────────
    // 클라이언트는 이 엔드포인트만 호출 — API 키는 이 파일 안에만 존재
    if (data.action === 'geminiGenerate') {
      const prompt = data.prompt || '';
      if (!prompt) {
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'error', message: 'prompt is required' }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: data.temperature || 0.3 }
      };

      const response = UrlFetchApp.fetch(GEMINI_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const result = JSON.parse(response.getContentText());

      if (result.error) {
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'error', message: result.error.message }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', text: text }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── OTP 이메일 발송 ────────────────────────────────────────────────
    if (data.action === 'sendOtp') {
      const toEmail = data.email || '';
      const code    = data.code  || '';
      if (!toEmail || !code) {
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'error', message: 'email or code missing' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      MailApp.sendEmail({
        to: toEmail,
        subject: '[score] 이메일 인증 코드',
        body:
          'score 앱 가입 인증 코드입니다.\n\n' +
          '인증 코드: ' + code + '\n\n' +
          '이 코드는 5분간 유효합니다.\n' +
          '본인이 요청하지 않은 경우 이 메일을 무시하세요.',
        htmlBody:
          '<div style="font-family:\'Noto Sans KR\',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fdfbf7;border:1px solid #e0dbd4;">' +
          '<p style="font-size:1.6rem;font-weight:700;letter-spacing:3px;margin:0 0 24px;color:#2c2a27;">score<span style="color:#e6b87a;">.</span></p>' +
          '<p style="color:#4a453f;font-size:0.95rem;margin-bottom:16px;">이메일 인증 코드입니다.</p>' +
          '<div style="background:#2c2a27;color:#fff;font-size:2rem;font-weight:700;letter-spacing:12px;text-align:center;padding:20px;margin:24px 0;">' + code + '</div>' +
          '<p style="color:#8a7f78;font-size:0.8rem;margin-top:24px;">이 코드는 5분간 유효합니다. 본인이 요청하지 않은 경우 무시하세요.</p>' +
          '</div>'
      });
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── 퀴즈 기록 저장 ────────────────────────────────────────────────
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    // 시트가 없으면 새로 생성 + 헤더 추가
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        '저장시각(KST)',
        '닉네임',
        '이메일',
        '유저ID',
        '퀴즈타입',
        '점수',
        '전체라운드',
        '정확도(%)',
        'XP',
        '최대콤보',
        '영화목록',
        '원본타임스탬프',
      ]);
      // 헤더 행 스타일
      const headerRange = sheet.getRange(1, 1, 1, 12);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#2c2a27');
      headerRange.setFontColor('#ffffff');
    }

    // KST 현재 시각
    const kstNow = Utilities.formatDate(
      new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'
    );

    sheet.appendRow([
      kstNow,
      data.nickname || '',
      data.userEmail || '',
      data.userId || '',
      data.type || '',
      data.score ?? '',
      data.total ?? '',
      data.accuracy ?? '',
      data.xp ?? '',
      data.combo ?? '',
      Array.isArray(data.movies) ? data.movies.join(', ') : '',
      data.timestamp || '',
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET 요청: action=getSheetData → S모드 AI 퀴즈용 시트 데이터 반환
// GET 요청: action=geminiGenerate → Gemini 프록시 (JSONP)
// JSONP 지원: &callback=함수명 파라미터 추가 시 JSONP 형식으로 응답
function doGet(e) {
  const params   = e && e.parameter ? e.parameter : {};
  const callback = params.callback || '';

  // ── Gemini AI 프록시 (GET/JSONP) ─────────────────────────────────────
  if (params.action === 'geminiGenerate') {
    try {
      const prompt = params.prompt || '';
      if (!prompt) {
        return _respond({ status: 'error', message: 'prompt is required' }, callback);
      }

      const temperature = parseFloat(params.temperature || '0.3');
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: temperature }
      };

      const response = UrlFetchApp.fetch(GEMINI_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const result = JSON.parse(response.getContentText());

      if (result.error) {
        return _respond({ status: 'error', message: result.error.message }, callback);
      }

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return _respond({ status: 'ok', text: text }, callback);

    } catch (err) {
      return _respond({ status: 'error', message: err.message }, callback);
    }
  }

  // ── S모드 AI 퀴즈용 시트 데이터 ─────────────────────────────────────
  if (params.action === 'getSheetData') {
    try {
      // 외부 스프레드시트 열기
      const DATA_SS_ID = '1iL4Vpu1YFaV4bTHlP-O-JnRiHdBvnSnQ7cCODzlrM60';
      const dataSS = SpreadsheetApp.openById(DATA_SS_ID);

      // ── 영화 상세 시트 (B4:AN) ─────────────────────────────────────
      const MOVIE_COLS = {
        0:'콘텐츠명', 1:'배급사', 2:'제작사', 4:'개봉일', 6:'장르',
        7:'감독', 8:'캐스팅', 9:'여성', 10:'10대', 11:'20대',
        12:'30대', 13:'40대', 14:'50대', 18:'개봉일좌석수',
        19:'개봉일스코어', 20:'개봉주스코어', 21:'최종스코어', 38:'극장매출비율'
      };
      const BAD_VALUES = ['o', 'value', '#value!', '#ref!', '#n/a', '#div/0!', ''];

      const movieSheet = dataSS.getSheetByName('영화 상세');
      const movieRaw = movieSheet.getRange('B4:AN200').getValues();
      const movieRows = [];
      for (var i = 1; i < movieRaw.length; i++) {
        var row = movieRaw[i];
        var title = String(row[0] || '').trim();
        if (!title || BAD_VALUES.indexOf(title.toLowerCase()) !== -1) continue;
        var obj = {};
        var hasData = false;
        for (var colIdx in MOVIE_COLS) {
          var key = MOVIE_COLS[colIdx];
          var val = colIdx < row.length ? String(row[colIdx] || '').trim() : '';
          if (BAD_VALUES.indexOf(val.toLowerCase()) !== -1) val = '';
          obj[key] = val;
          if (val && key !== '콘텐츠명') hasData = true;
        }
        if (hasData) movieRows.push(obj);
      }

      // ── 북미극장 시트 (B3:N) ──────────────────────────────────────
      const NABOX_KEYS = ['연도','금요일','순위','전주순위','콘텐츠','수익','전주대비','극장수','극장수전주대비','평균수익','누적수익','개봉주차','배급사'];
      const naSheet = dataSS.getSheetByName('북미극장');
      const naRaw = naSheet.getRange('B3:N500').getValues();
      const naRows = [];
      for (var j = 1; j < naRaw.length; j++) {
        var nrow = naRaw[j];
        var content = String(nrow[4] || '').trim();
        if (!content || BAD_VALUES.indexOf(content.toLowerCase()) !== -1) continue;
        var nobj = {};
        for (var k = 0; k < NABOX_KEYS.length; k++) {
          var nval = k < nrow.length ? String(nrow[k] || '').trim() : '';
          if (BAD_VALUES.indexOf(nval.toLowerCase()) !== -1) nval = '';
          nobj[NABOX_KEYS[k]] = nval;
        }
        naRows.push(nobj);
      }

      return _respond({ status: 'ok', movieDetail: movieRows, naBoxOffice: naRows }, callback);

    } catch (err) {
      return _respond({ status: 'error', message: err.message }, callback);
    }
  }

  // ── 기본 GET: 레코드 수 확인 ────────────────────────────────────────
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const rows = sheet ? sheet.getLastRow() - 1 : 0;
  return _respond({ status: 'ok', records: rows }, callback);
}

