/**
 * score 앱 — 퀴즈 기록 수신 & Google Sheets 저장
 *
 * [설치 방법]
 * 1. Google Sheets에서 새 시트를 만듭니다.
 * 2. 상단 메뉴 → 확장 프로그램 → Apps Script 열기
 * 3. 이 코드를 붙여넣고 저장합니다.
 * 4. 배포 → 새 배포 → 웹 앱으로 배포
 *    - 실행 계정: 나
 *    - 액세스 권한: 모든 사용자 (익명 포함)
 * 5. 배포 URL을 복사해서 index.html의 SCORE_SHEET_WEBHOOK_URL 에 붙여넣습니다.
 */

const SHEET_NAME = 'quiz_records';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
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
