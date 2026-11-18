/********************************************************************
 * Setup.gs — ติดตั้งระบบและทดสอบ (รันจาก Apps Script editor)
 *  ลำดับครั้งแรก: setup → syncUsers → seedRoles → (วาง DMC) importDMC → pullAttendance → installTriggers → testSystem
 ********************************************************************/

/** สร้างทุกชีตในทั้ง 2 ไฟล์ และใส่ค่าตั้งต้น (รันซ้ำได้ ไม่ทับข้อมูลเดิม) */
function setup() {
  Object.keys(SCHEMA).forEach(function (n) { sheet_(n); });

  var have = {}; rows_('Config').forEach(function (r) { have[r.key] = 1; });
  append_('Config', CONFIG_DEFAULTS.filter(function (d) { return !have[d[0]]; }).map(function (d) { return { key: d[0], value: d[1], note: d[2] }; }));
  delete MEMO_._cfg;

  var perm = {}; rows_('Permissions').forEach(function (r) { perm[r.action] = 1; });
  append_('Permissions', PERMISSIONS_SEED.filter(function (r) { return !perm[r[0]]; }).map(function (r) {
    return { action: r[0], label: r[1], executive: r[2] ? 'TRUE' : 'FALSE', head: r[3] ? 'TRUE' : 'FALSE', advisor: r[4] ? 'TRUE' : 'FALSE', score_admin: r[5] ? 'TRUE' : 'FALSE', sysadmin: r[6] ? 'TRUE' : 'FALSE' };
  }));
  clearPermCache_();

  if (!rows_('ScoreItems').length) {
    var stamp = now_();
    append_('ScoreItems', SCORE_ITEMS_SEED.map(function (r, i) {
      return { item_id: r[0], type: r[1], category: r[2], item_name: r[3], points: r[4], guidance: r[5], is_severe: r[6] ? 'TRUE' : 'FALSE',
               active: 'TRUE', sort_order: i + 1, updated_by: 'ตั้งต้น', updated_at: stamp };
    }));
  }
  if (!rows_('CertRules').length) {
    append_('CertRules', CERT_RULES_SEED.map(function (r, i) { return { min_score: r[0], max_score: r[1], label: r[2], issue_cert: r[3] ? 'TRUE' : 'FALSE', sort_order: i + 1 }; }));
  }
  if (!rows_('AttendanceSources').length) {
    append_('AttendanceSources', ATTENDANCE_SOURCES_SEED.map(function (r) { return { year: r[0], term: r[1], file_id: r[2], label: r[3], active: r[4] ? 'TRUE' : 'FALSE' }; }));
  }
  seedShield_(year_());
  pepper_();

  // ลบชีตว่างตั้งต้น "ชีต1"/"Sheet1"
  ['SYSTEM', 'DATA'].forEach(function (f) {
    var ss = book_(f);
    ['ชีต1', 'Sheet1'].forEach(function (nm) {
      var s = ss.getSheetByName(nm);
      if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s);
    });
  });
  // ชีต DMC สำหรับวางข้อมูล
  if (!book_('DATA').getSheetByName('DMC')) book_('DATA').insertSheet('DMC');

  bumpSummary_();
  var msg = 'ติดตั้ง KJST Shield ' + VERSION + ' แล้ว · ชีตระบบ ' + book_('SYSTEM').getSheets().length + ' ชีต · ชีตข้อมูล ' + book_('DATA').getSheets().length + ' ชีต';
  Logger.log(msg);
  selfTestPbkdf2();
  return msg;
}

/* ===== ฟังก์ชันสำหรับรันจาก editor ===== */
function syncUsers() { Logger.log(JSON.stringify(syncUsers_('editor'), null, 1)); }
function seedRoles() { Logger.log(JSON.stringify(seedRoles_('editor', false), null, 1)); }
function importDMC() { Logger.log(JSON.stringify(importDMC_('editor'))); }
function importOpening() { Logger.log(JSON.stringify(importOpening_('editor'))); }
function pullAttendance() { Logger.log(JSON.stringify(pullAttendance_('editor'), null, 1)); }
function clearSummaryCache() { bumpSummary_(); Logger.log('ล้าง cache ผลสรุปแล้ว (SUM_VER=' + sumVer_() + ')'); }

/** ทดสอบระบบโดยจำลอง session ของผู้ดูแลระบบ (T304) — ดูผลใน Execution log */
function testSystem() {
  var t0 = Date.now();
  Logger.log('1) PBKDF2: ' + (selfTestPbkdf2() ? 'ผ่าน' : 'ไม่ผ่าน'));
  Logger.log('2) ping: ' + JSON.stringify(handle_({ action: 'ping' })));
  var u = rows_('Users_Shield').filter(function (r) { return r.staff_id === 'T304'; })[0];
  if (!u) { Logger.log('ยังไม่มี T304 ใน Users_Shield — รัน syncUsers และ seedRoles ก่อน'); return; }
  var s = staffSession_(u, 'test');
  Logger.log('3) session: ' + s.user.name + ' · ' + s.user.roleNames.join(', ') + ' · สิทธิ์ ' + s.user.perms.length + ' รายการ');
  ['init', 'dashboard', 'students', 'scoreItems', 'careList', 'settingsGet', 'shield'].forEach(function (a) {
    var t = Date.now(), r = handle_({ action: a, session: s.session });
    var info = r.ok ? (Array.isArray(r.data) ? r.data.length + ' แถว' : 'ok') : ('ผิดพลาด: ' + r.error);
    Logger.log('   ' + a + ': ' + info + ' (' + (Date.now() - t) + ' ms)');
  });
  var d = handle_({ action: 'dashboard', session: s.session });
  if (d.ok) Logger.log('4) dashboard: นักเรียน ' + d.data.total + ' คน · ระดับ ' + JSON.stringify(d.data.levels) + ' · มาเรียนเฉลี่ย ' + d.data.avgRate + '%');
  var bad = handle_({ action: 'rulesSaveItem', session: 'x' });
  Logger.log('5) session ปลอม ต้องถูกปฏิเสธ: ' + (!bad.ok && bad.code === 'AUTH' ? 'ผ่าน' : 'ไม่ผ่าน'));
  dropSession_(s.session);
  Logger.log('เสร็จใน ' + (Date.now() - t0) + ' ms');
}
