/********************************************************************
 * Students.gs — ข้อมูลนักเรียน
 *  1) ซิงก์จากฐานข้อมูลนักเรียนกลาง (ชีต "ทะเบียนนักเรียน") — ข้อมูลหลัก ไม่มีเลขประจำตัวประชาชน
 *  2) ข้อมูลเสริมจาก DMC (ชีต "DMC" ในไฟล์ database) — เบอร์ผู้ปกครอง และรหัสเข้าระบบนักเรียน
 *     (เก็บเฉพาะ HMAC ของเลขบัตร+วันเกิด และเลข 4 ตัวท้าย ไม่เก็บเลขบัตรเต็ม)
 *  3) ยอดคะแนนยกมา
 ********************************************************************/

var STUDENT_SYNC_COLS = ['student_id', 'number', 'prefix', 'first_name', 'last_name', 'gender', 'grade', 'room', 'status', 'status_date', 'guardian_name', 'guardian_relation', 'synced_at'];

function isActiveStudent_(s) { return s.status === ACTIVE_STATUS; }

/** ซิงก์จากทะเบียนนักเรียนกลาง: แก้เฉพาะคอลัมน์ข้อมูลหลัก ข้อมูลเสริมจาก DMC คงเดิม */
function syncStudents_(by) {
  var src = readExternal_(fileId_('STUDENTS'), 'ทะเบียนนักเรียน');
  if (!src.length) throw err_('INPUT', 'ไม่พบข้อมูลในชีต "ทะเบียนนักเรียน" ของฐานข้อมูลนักเรียนกลาง');
  var cur = {}; rows_('Students').forEach(function (r) { cur[r.student_id] = r; });
  var stamp = now_(), upd = [], add = [], seen = {}, counts = {};
  src.forEach(function (r) {
    var id = sid_(r['เลขประจำตัวนักเรียน']);
    if (!id || seen[id]) return;
    seen[id] = 1;
    var o = {
      student_id: id, number: r['เลขที่'], prefix: r['คำนำหน้า'], first_name: r['ชื่อ'], last_name: r['นามสกุล'], gender: r['เพศ'],
      grade: normGrade_(r['ระดับชั้น']), room: normRoom_(r['ห้อง']), status: r['สถานะ'] || ACTIVE_STATUS, status_date: r['วันที่เปลี่ยนสถานะ'],
      guardian_name: r['ชื่อ-สกุลผู้ปกครอง'], guardian_relation: r['ผู้ปกครองเป็น'], synced_at: stamp
    };
    counts[o.status] = (counts[o.status] || 0) + 1;
    if (cur[id]) upd.push(Object.assign({}, cur[id], o)); else add.push(o);
  });
  var missing = Object.keys(cur).filter(function (k) { return !seen[k]; });
  missing.forEach(function (k) { if (cur[k].status !== 'ไม่อยู่ในทะเบียนกลาง') upd.push(Object.assign({}, cur[k], { status: 'ไม่อยู่ในทะเบียนกลาง', synced_at: stamp })); });
  lock_(function () { updateRows_('Students', upd); append_('Students', add); });
  bumpSummary_();
  var res = { total: Object.keys(seen).length, added: add.length, updated: upd.length - missing.length, status: counts, notInRegistry: missing.length };
  audit_(by, 'studentsSync', res);
  return res;
}

/** ข้อมูลเสริมจาก DMC: เบอร์ผู้ปกครอง + รหัสเข้าระบบนักเรียน (จับคู่ด้วยเลขประจำตัวนักเรียน) */
function importDMC_(by) {
  var s = book_('DATA').getSheetByName('DMC');
  if (!s || s.getLastRow() < 2) throw err_('INPUT', 'ไม่พบข้อมูลในชีต "DMC" ของไฟล์ database — วางข้อมูลจากไฟล์ DMC ก่อน');
  var v = s.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var c = function (n) { return h.indexOf(n); };
  var I = { id: c('รหัสนักเรียน'), nid: c('เลขประจำตัวประชาชน'), dob: c('วันเกิด'),
            pph: c('หมายเลขโทรศัพท์ของผู้ปกครอง'), mph: c('หมายเลขโทรศัพท์ของมารดา'), fph: c('หมายเลขโทรศัพท์ของบิดา') };
  if (I.id < 0) throw err_('INPUT', 'ชีต DMC ไม่มีคอลัมน์ "รหัสนักเรียน"');
  var get = function (row, k) { return I[k] >= 0 ? str_(row[I[k]]) : ''; };
  var cur = {}; rows_('Students').forEach(function (r) { cur[r.student_id] = r; });
  if (!Object.keys(cur).length) throw err_('INPUT', 'ยังไม่มีรายชื่อนักเรียน — ซิงก์จากฐานข้อมูลนักเรียนกลางก่อน');
  var upd = [], noMatch = 0, noAuth = 0, stamp = now_(), seen = {};
  for (var i = 1; i < v.length; i++) {
    var row = v[i], id = sid_(get(row, 'id'));
    if (!id || seen[id]) continue;
    seen[id] = 1;
    if (!cur[id]) { noMatch++; continue; }
    var nid = I.nid >= 0 ? nid_(row[I.nid]) : '', dob = I.dob >= 0 ? normDob_(row[I.dob]) : '';
    var auth = (nid.length === 13 && dob) ? studentAuthHash_(nid, dob) : '';
    if (!auth) noAuth++;
    upd.push(Object.assign({}, cur[id], {
      parent_phone: get(row, 'pph') || get(row, 'mph') || get(row, 'fph') || cur[id].parent_phone,
      nid_last4: nid ? nid.slice(-4) : cur[id].nid_last4, auth_hash: auth || cur[id].auth_hash, dmc_at: stamp
    }));
  }
  lock_(function () { updateRows_('Students', upd); });
  var noLogin = rows_('Students').filter(function (r) { return isActiveStudent_(r) && !r.auth_hash; }).length;
  var res = { updated: upd.length, notInRegistry: noMatch, noAuth: noAuth, activeWithoutLogin: noLogin };
  audit_(by, 'importDMC', res);
  return res;
}

/** ยอดยกมา: ชีต "ยอดยกมา" ในไฟล์ database คอลัมน์ A = รหัสนักเรียน, B = คะแนนคงเหลือ ณ วันเปิดระบบ */
function importOpening_(by) {
  var s = book_('DATA').getSheetByName('ยอดยกมา');
  if (!s || s.getLastRow() < 2) throw err_('INPUT', 'ไม่พบชีต "ยอดยกมา" ในไฟล์ database (คอลัมน์ A = รหัสนักเรียน, B = คะแนนคงเหลือ)');
  var v = s.getDataRange().getValues(), stu = studentMap_(), base = cfgNum_('BASE_SCORE');
  var done = {};
  rows_('BehaviorLog').forEach(function (b) { if (b.item_id === 'OPEN' && b.status !== 'void') done[b.student_id + '|' + b.stage] = 1; });
  var logs = [], skipped = 0, stamp = now_(), y = year_(), t = term_(), tag = Date.now().toString(36);
  for (var i = 1; i < v.length; i++) {
    var id = sid_(v[i][0]), raw = String(v[i][1]).trim(), sc = Number(raw), st = stu[id];
    if (!st || raw === '' || isNaN(sc)) { if (id) skipped++; continue; }
    var stg = stage_(st.grade);
    if (done[id + '|' + stg] || sc === base) continue;
    var d = sc - base;
    logs.push({
      log_id: 'O' + tag + '_' + i, date: today_(), year: y, term: t, student_id: id, grade: st.grade, room: st.room, stage: stg,
      item_id: 'OPEN', type: d < 0 ? 'หัก' : 'เพิ่ม', category: 'ยอดยกมา', item_name: 'ยอดยกมาจากระบบเดิม', points: d, severe: 'FALSE',
      note: 'คะแนนคงเหลือเดิม ' + sc, recorded_by: by, recorded_at: stamp, status: 'active'
    });
  }
  lock_(function () { append_('BehaviorLog', logs); });
  bumpSummary_();
  audit_(by, 'importOpening', { added: logs.length, skipped: skipped });
  return { added: logs.length, skipped: skipped };
}

function activeStudents_() {
  return rows_('Students').filter(function (s) { return isActiveStudent_(s) && s.grade && s.room; });
}
function studentMap_() { var m = {}; rows_('Students').forEach(function (s) { m[s.student_id] = s; }); return m; }

/** ห้องทั้งหมดของโรงเรียน { 'ม.1': ['1','2',...], ... } */
function classMap_() {
  var m = {};
  activeStudents_().forEach(function (s) { (m[s.grade] = m[s.grade] || {})[s.room] = 1; });
  var out = {};
  Object.keys(m).sort(function (a, b) { return gnum_(a) - gnum_(b); }).forEach(function (g) {
    out[g] = Object.keys(m[g]).sort(function (a, b) { return Number(a) - Number(b); });
  });
  return out;
}
