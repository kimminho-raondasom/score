/**
 * score 앱 — 퀴즈 기록 수신 & Google Sheets 저장 + 이메일 OTP 인증
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
 * POST { action: 'sendOtp', email: '...', code: '123456' }
 * → 해당 이메일로 6자리 인증 코드 발송
 */

const SHEET_NAME = 'quiz_records';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

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
      (data.movies || []).join(', '),
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

// GET 요청 테스트용 (브라우저에서 URL 직접 열었을 때 확인)
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const rows = sheet ? sheet.getLastRow() - 1 : 0;
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', records: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}
