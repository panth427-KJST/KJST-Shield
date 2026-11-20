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
    if (cur[id]) {   // ช่องที่แอดมินแก้เองใน Shield (edited_fields) ไม่ถูกเขียนทับ
      splitList_(cur[id].edited_fields).forEach(function (f) { delete o[f]; });
      if (!cur[id].student_type) o.student_type = STUDENT_TYPES[0];
      upd.push(Object.assign({}, cur[id], o));
    } else { o.student_type = STUDENT_TYPES[0]; add.push(o); }
  });
  var missing = Object.keys(cur).filter(function (k) { return !seen[k]; });
  missing.forEach(function (k) { if (cur[k].status !== 'ไม่อยู่ในทะเบียนกลาง') upd.push(Object.assign({}, cur[k], { status: 'ไม่อยู่ในทะเบียนกลาง', synced_at: stamp })); });
  lock_(function () { updateRows_('Students', upd); append_('Students', add); });
  bumpSummary_();
  var res = { total: Object.keys(seen).length, added: add.length, updated: upd.length - missing.length, status: counts, notInRegistry: missing.length };
  audit_(by, 'studentsSync', res);
  return res;
}

/** ข้อมูลเสริมจาก DMC (นำเข้าครั้งเดียว): เบอร์ผู้ปกครอง + รหัสเข้าระบบนักเรียน (จับคู่ด้วยเลขประจำตัวนักเรียน)
 *  removeSheet = true → ลบชีต DMC ทิ้งหลังนำเข้าสำเร็จ (ไม่ให้เลขบัตรเต็มค้างในไฟล์) */
function importDMC_(by, removeSheet) {
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
  var res = { updated: upd.length, notInRegistry: noMatch, noAuth: noAuth, activeWithoutLogin: noLogin, sheetRemoved: false };
  if (removeSheet && upd.length) { book_('DATA').deleteSheet(s); res.sheetRemoved = true; }
  audit_(by, 'importDMC', res);
  return res;
}

/** ตั้งรหัสเข้าระบบรายคน (นักเรียนย้ายเข้าใหม่หลังนำเข้า DMC) — ไม่เก็บเลขบัตรเต็ม */
function setStudentAuth_(by, p) {
  var id = sid_(p.student_id), nid = nid_(p.nid), dob = normDob_(p.dob);
  if (nid.length !== 13) throw err_('INPUT', 'กรุณากรอกเลขประจำตัวประชาชน 13 หลัก');
  if (!dob) throw err_('INPUT', 'กรุณากรอกวันเกิดเป็น วว/ดด/ปปปป (พ.ศ.)');
  return lock_(function () {
    dirty_('Students');
    var s = rows_('Students').filter(function (r) { return r.student_id === id; })[0];
    if (!s) throw err_('NOTFOUND', 'ไม่พบนักเรียนรหัส ' + id);
    var o = { auth_hash: studentAuthHash_(nid, dob), nid_last4: nid.slice(-4), dmc_at: now_() + ' (กรอกรายคน)' };
    if (p.parent_phone) o.parent_phone = String(p.parent_phone).replace(/[^\d-]/g, '');
    updateRows_('Students', [Object.assign({}, s, o)]);
    audit_(by, 'setStudentAuth', { student_id: id });
    return { student_id: id, name: fullName_(s) };
  });
}

/** นักเรียนปัจจุบันที่ยังไม่มีรหัสเข้าระบบ */
function studentsNoAuth_() {
  return activeStudents_().filter(function (s) { return !s.auth_hash; })
    .map(function (s) { return { id: s.student_id, name: fullName_(s), cls: cls_(s.grade, s.room) }; });
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


/* ===== แก้ไขข้อมูลนักเรียน (แอดมิน): ผู้ปกครอง · เบอร์โทร · ประเภทนักเรียน — แก้ใน Shield เท่านั้น ===== */
var STUDENT_EDIT_FIELDS = { guardian_name: 'ชื่อผู้ปกครอง', guardian_relation: 'ความเกี่ยวข้อง', parent_phone: 'เบอร์โทรผู้ปกครอง', student_type: 'ประเภทนักเรียน' };
var SYNCED_FIELDS = ['guardian_name', 'guardian_relation'];   // มาจากทะเบียนกลาง → ต้องกันไม่ให้ซิงก์ทับ

function studentSave_(u, p) {
  var id = sid_(p.id), reason = String(p.reason || '').trim();
  var cur = rows_('Students').filter(function (r) { return r.student_id === id; })[0];
  if (!cur) throw err_('NOTFOUND', 'ไม่พบนักเรียน');
  var nw = {}, logs = [], edited = splitList_(cur.edited_fields);
  Object.keys(STUDENT_EDIT_FIELDS).forEach(function (f) {
    if (p[f] === undefined) return;
    var v = String(p[f] || '').trim().slice(0, 120);
    if (f === 'parent_phone') { v = v.replace(/[^\d,\s-]/g, ''); }
    if (f === 'student_type' && STUDENT_TYPES.indexOf(v) < 0) throw err_('INPUT', 'ประเภทนักเรียนไม่ถูกต้อง');
    var old = str_(cur[f]) || (f === 'student_type' ? STUDENT_TYPES[0] : '');
    if (old === v) return;
    nw[f] = v;
    if (SYNCED_FIELDS.indexOf(f) >= 0 && edited.indexOf(f) < 0) edited.push(f);
    logs.push({ student_id: id, student_name: fullName_(cur), field: STUDENT_EDIT_FIELDS[f], old_value: old, new_value: v });
  });
  if (!logs.length) return { changed: 0 };
  nw.edited_fields = edited.join(','); nw.edited_by = by_(u); nw.edited_at = now_();
  lock_(function () { updateRows_('Students', [Object.assign({}, cur, nw)]); });
  editLog_(u, { kind: 'ประวัตินักเรียน', date: today_(), room: cls_(cur.grade, cur.room), reason: reason || 'แก้ไขข้อมูลนักเรียน', batch_id: newBatch_() }, logs);
  bumpSummary_();
  return { changed: logs.length };
}

/** ตั้งประเภทนักเรียนหลายคนพร้อมกัน */
function studentTypeBulk_(u, p) {
  var type = String(p.type || ''), ids = {};
  if (STUDENT_TYPES.indexOf(type) < 0) throw err_('INPUT', 'ประเภทนักเรียนไม่ถูกต้อง');
  [].concat(p.ids || []).forEach(function (x) { var i = sid_(x); if (i) ids[i] = 1; });
  if (!Object.keys(ids).length) throw err_('INPUT', 'กรุณาเลือกนักเรียน');
  var upd = [], logs = [], stamp = now_();
  rows_('Students').forEach(function (r) {
    if (!ids[r.student_id]) return;
    var old = r.student_type || STUDENT_TYPES[0];
    if (old === type) return;
    upd.push(Object.assign({}, r, { student_type: type, edited_by: by_(u), edited_at: stamp }));
    logs.push({ student_id: r.student_id, student_name: fullName_(r), field: 'ประเภทนักเรียน', old_value: old, new_value: type, room: cls_(r.grade, r.room) });
  });
  if (!upd.length) return { changed: 0 };
  lock_(function () { updateRows_('Students', upd); });
  editLog_(u, { kind: 'ประวัตินักเรียน', date: today_(), reason: String(p.reason || '').trim() || 'ตั้งประเภทนักเรียน', batch_id: newBatch_() }, logs);
  bumpSummary_();
  return { changed: upd.length };
}
