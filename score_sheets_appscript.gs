/**
 * score 앱 — 퀴즈 기록 수신 & Google Sheets 저장 + 이메일 OTP 인증 (v2)
 *
 * [OTP 보안 강화 (2026-08-09)]
 * - 서버에서 OTP 코드 생성·저장·검증 (클라이언트가 코드를 알 수 없음)
 * - PropertiesService로 5분 유효기간 관리
 * - 인증 완료 시 코드 즉시 폐기
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
 * [OTP 인증 엔드포인트]
 * GET ?action=sendOtp&email=...       → 서버가 OTP 생성 후 이메일 발송
 * GET ?action=verifyOtp&email=...&code=... → 서버에서 코드 검증
 */

const SHEET_NAME = 'quiz_records';
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5분

// ── OTP 헬퍼 ────────────────────────────────────────────────────────────────
function _generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function _storeOtp(email, code) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('otp_' + email, JSON.stringify({
    code: code,
    expires: Date.now() + OTP_EXPIRY_MS,
    attempts: 0
  }));
}

function _verifyOtpInternal(email, inputCode) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('otp_' + email);
  if (!raw) return { valid: false, reason: 'no_code' };

  var data;
  try { data = JSON.parse(raw); } catch(e) { return { valid: false, reason: 'invalid_data' }; }

  if (Date.now() > data.expires) {
    props.deleteProperty('otp_' + email);
    return { valid: false, reason: 'expired' };
  }

  if (inputCode !== data.code) {
    data.attempts = (data.attempts || 0) + 1;
    if (data.attempts >= 5) {
      props.deleteProperty('otp_' + email);
      return { valid: false, reason: 'max_attempts' };
    }
    props.setProperty('otp_' + email, JSON.stringify(data));
    return { valid: false, reason: 'mismatch', attemptsLeft: 5 - data.attempts };
  }

  props.deleteProperty('otp_' + email);
  return { valid: true };
}

// ── 이메일 전송 헬퍼 ────────────────────────────────────────────────────────
function _sendOtpEmail(toEmail, code) {
  console.log('[sendOtp] Sending to:', toEmail, 'code:', code);
  MailApp.sendEmail({
    to: toEmail,
    subject: '[score] Email Verification',
    body:
      'Your verification code: ' + code + '\n\n' +
      'This code is valid for 5 minutes.\n' +
      'If you did not request this, please ignore this email.'
  });
  console.log('[sendOtp] Sent OK to:', toEmail);
}

function _ensureSheet(sheet) {
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
    sheet.appendRow([
      '저장시각(KST)', '닉네임', '이메일', '유저ID', '퀴즈타입',
      '점수', '전체라운드', '정확도(%)', 'XP', '최대콤보', '영화목록', '원본타임스탬프',
    ]);
    var headerRange = sheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#2c2a27');
    headerRange.setFontColor('#ffffff');
  }
  return sheet;
}

// ── POST ────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'sendOtp') {
      var toEmail = (data.email || '').trim().toLowerCase();
      if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'error', message: 'invalid email' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var code = _generateOtpCode();
      _storeOtp(toEmail, code);
      _sendOtpEmail(toEmail, code);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'verifyOtp') {
      var email = (data.email || '').trim().toLowerCase();
      var inputCode = (data.code || '').trim();
      if (!email || !inputCode) {
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'error', message: 'email or code missing' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var result = _verifyOtpInternal(email, inputCode);
      return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 퀴즈 기록 저장
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss.getSheetByName(SHEET_NAME));
    sheet.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      data.nickname || '', data.userEmail || '', data.userId || '',
      data.type || '', data.score ?? '', data.total ?? '',
      data.accuracy ?? '', data.xp ?? '', data.combo ?? '',
      (data.movies || []).join(', '), data.timestamp || '',
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

// ── GET (CORS 우회용, 모든 API는 GET 파라미터로) ────────────────────────────
function doGet(e) {
  if (!e || !e.parameter) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    var rows = sheet ? sheet.getLastRow() - 1 : 0;
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', records: rows }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var p = e.parameter;

  // ── OTP 발송 (서버에서 코드 생성) ────────────────────────────────────
  if (p.action === 'sendOtp') {
    var toEmail = (p.email || '').trim().toLowerCase();
    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'invalid email' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var code = _generateOtpCode();
    _storeOtp(toEmail, code);
    try {
      _sendOtpEmail(toEmail, code);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', sentTo: toEmail }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (mailErr) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'mail_send_failed: ' + mailErr.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // ── OTP 검증 (서버에서 코드 비교) ────────────────────────────────────
  if (p.action === 'verifyOtp') {
    var email = (p.email || '').trim().toLowerCase();
    var inputCode = (p.code || '').trim();
    if (!email || !inputCode) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'email or code missing' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var result = _verifyOtpInternal(email, inputCode);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 퀴즈 기록 저장 ──────────────────────────────────────────────────
  if (p.action === 'saveQuiz') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _ensureSheet(ss.getSheetByName(SHEET_NAME));
    sheet.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      p.nickname || '', p.email || '', p.userId || '',
      p.type || '', p.score || '', p.total || '',
      p.accuracy || '', p.xp || '', p.combo || '',
      p.movies || '', p.timestamp || new Date().toISOString(),
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 단체전 결과 이메일 발송 ─────────────────────────────────────────
  if (p.action === 'sendGroupResult') {
    var emails = (p.emails || '').split(',');
    var subject = p.subject || '[score] 단체전 예측 결과';
    var bodyHtml = p.bodyHtml || '';
    emails.forEach(function(toEmail) {
      if (toEmail) {
        MailApp.sendEmail({ to: toEmail, subject: subject, htmlBody: bodyHtml });
      }
    });
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', sent: emails.length }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 기본: 기록 수 반환
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var rows = sheet ? sheet.getLastRow() - 1 : 0;
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', records: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}
