/********************************************************************
 * Students.gs — นำเข้านักเรียนจาก DMC และยอดคะแนนยกมา
 ********************************************************************/

/** นำเข้าจากชีต "DMC" ในไฟล์ database (วางข้อมูลจากไฟล์ DMC ทั้งแผ่น) */
function importDMC_(by) {
  var s = book_('DATA').getSheetByName('DMC');
  if (!s || s.getLastRow() < 2) throw err_('INPUT', 'ไม่พบข้อมูลในชีต "DMC" ของไฟล์ database — วางข้อมูลจากไฟล์ DMC ก่อน');
  var v = s.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var c = function (n) { return h.indexOf(n); };
  var I = {
    id: c('รหัสนักเรียน'), nid: c('เลขประจำตัวประชาชน'), g: c('ชั้น'), r: c('ห้อง'), sex: c('เพศ'), pre: c('คำนำหน้าชื่อ'),
    fn: c('ชื่อ'), ln: c('นามสกุล'), dob: c('วันเกิด'), pfn: c('ชื่อผู้ปกครอง'), pln: c('นามสกุลผู้ปกครอง'),
    pph: c('หมายเลขโทรศัพท์ของผู้ปกครอง'), mph: c('หมายเลขโทรศัพท์ของมารดา'), fph: c('หมายเลขโทรศัพท์ของบิดา')
  };
  ['id', 'g', 'r', 'fn', 'ln'].forEach(function (k) { if (I[k] < 0) throw err_('INPUT', 'ชีต DMC ไม่มีคอลัมน์ที่จำเป็น (' + k + ')'); });
  var get = function (row, k) { return I[k] >= 0 ? str_(row[I[k]]) : ''; };
  var old = {}; rows_('Students').forEach(function (r) { old[r.student_id] = r; });
  var out = [], seen = {}, noAuth = 0, stamp = now_();
  for (var i = 1; i < v.length; i++) {
    var row = v[i], id = sid_(get(row, 'id'));
    if (!id || seen[id]) continue;
    seen[id] = 1;
    var sx = get(row, 'sex'), nid = I.nid >= 0 ? nid_(row[I.nid]) : '', dob = I.dob >= 0 ? normDob_(row[I.dob]) : '';
    var auth = (nid.length === 13 && dob) ? studentAuthHash_(nid, dob) : '';
    if (!auth) noAuth++;
    out.push({
      student_id: id, prefix: get(row, 'pre'), first_name: get(row, 'fn'), last_name: get(row, 'ln'),
      gender: (sx === 'ช' || sx === 'ชาย') ? 'ชาย' : ((sx === 'ญ' || sx === 'หญิง') ? 'หญิง' : sx),
      grade: normGrade_(get(row, 'g')), room: normRoom_(get(row, 'r')),
      status: (old[id] && INACTIVE_STATUS.indexOf(old[id].status) >= 0) ? old[id].status : 'กำลังศึกษา',
      parent_name: (get(row, 'pfn') + ' ' + get(row, 'pln')).trim(),
      parent_phone: get(row, 'pph') || get(row, 'mph') || get(row, 'fph'),
      nid_last4: nid ? nid.slice(-4) : '', auth_hash: auth, imported_at: stamp
    });
  }
  if (!out.length) throw err_('INPUT', 'ชีต DMC ไม่มีข้อมูลนักเรียน');
  var gone = Object.keys(old).filter(function (k) { return !seen[k]; });
  lock_(function () { writeAll_('Students', out); });
  bumpSummary_();
  audit_(by, 'importDMC', { students: out.length, noAuth: noAuth, notInDmc: gone.length });
  return { count: out.length, noAuth: noAuth, notInDmc: gone.length };
}

/** ยอดยกมา: ชีต "ยอดยกมา" ในไฟล์ database คอลัมน์ รหัสนักเรียน, คะแนน (คะแนนคงเหลือ ณ วันเปิดระบบ) */
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
  return rows_('Students').filter(function (s) { return INACTIVE_STATUS.indexOf(s.status) < 0 && s.grade && s.room; });
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
