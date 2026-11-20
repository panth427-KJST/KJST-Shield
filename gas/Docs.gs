/********************************************************************
 * Docs.gs — เมนูรายงาน (คะแนนความประพฤติ)
 *  รายงานการหักคะแนน (รห.)  : รายการหักคะแนนที่ไม่มีมาตรการเพิ่มเติม · 1 ฉบับ / 1 รายการ
 *  บันทึกพฤติกรรม (บพ.)     : รายการหักคะแนนที่มีมาตรการเพิ่มเติม · แอดมินกรอกรายละเอียดก่อนพิมพ์
 *  เลขที่เอกสาร "รห. 2569/0001" · "บพ. 2569/0001" แยกลำดับตามประเภทและปีการศึกษา · ออกครั้งแรกแล้วคงเดิม
 *  ผู้ลงนามตั้งต้น: Config DOC_SIGNERS (ติ๊กเลือก/แก้ชื่อ-ตำแหน่งได้) · แก้เฉพาะฉบับได้ (เก็บในเอกสาร)
 ********************************************************************/

var DOC_KINDS = { 'รห': 'รายงานการหักคะแนนความประพฤตินักเรียน', 'บพ': 'บันทึกพฤติกรรมนักเรียน' };
var DOC_SIGNERS_SEED = [
  { code: 'T520', pos: 'หัวหน้ากลุ่มบริหารงานกิจการนักเรียน', on: true },
  { code: 'T003', pos: 'รองผู้อำนวยการกลุ่มบริหารงานกิจการนักเรียน', on: true },
  { code: 'T001', pos: 'ผู้อำนวยการโรงเรียนกาญจนาภิเษกวิทยาลัย สุราษฎร์ธานี', on: true }
];

function staffNames_() {
  var m = {}; rows_('Users_Shield').forEach(function (r) { m[String(r.staff_id).toUpperCase()] = r; }); return m;
}

function docSigners_() {
  var v = cfg_('DOC_SIGNERS');
  if (v) { try { var a = JSON.parse(v); if (a && a.length) return a; } catch (e) {} }
  var st = staffNames_();
  return DOC_SIGNERS_SEED.map(function (s) { return { code: s.code, name: (st[s.code] || {}).display_name || '', pos: s.pos, on: s.on }; });
}
function cleanSigners_(list) {
  return [].concat(list || []).slice(0, 6).map(function (s) {
    return { code: str_(s.code).slice(0, 10), name: str_(s.name).slice(0, 120), pos: str_(s.pos).slice(0, 160), on: !!s.on };
  }).filter(function (s) { return s.name || s.pos; });
}
function docSignersSave_(u, p) {
  var list = cleanSigners_(p.signers);
  if (!list.length) throw err_('INPUT', 'กรุณาระบุผู้ลงนามอย่างน้อย 1 ท่าน');
  setCfg_('DOC_SIGNERS', JSON.stringify(list));
  audit_(by_(u), 'docSignersSave', list.map(function (s) { return (s.on ? '✓ ' : '') + s.name; }).join(', '));
  return list;
}

/** รายการหักคะแนนสำหรับออกเอกสาร (ปีการศึกษานี้) */
function reportList_(p) {
  var y = year_(), from = normDate_(p.from) || '', to = normDate_(p.to) || '9999', q = String(p.q || '').trim().toLowerCase();
  var cls = String(p.cls || ''), filter = String(p.filter || 'all'), stu = studentMap_();
  var ms = {}; rows_('MeasureLog').forEach(function (m) { if (m.status !== 'void') (ms[m.log_id] = ms[m.log_id] || []).push(m.name); });
  var docs = {}; rows_('BehaviorDocs').forEach(function (d) { docs[d.log_id] = d; });
  var list = rows_('BehaviorLog').filter(function (b) {
    if (b.year !== y || b.status === 'void' || num_(b.points) >= 0 || b.item_id === 'OPEN') return false;
    if (b.date < from || b.date > to) return false;
    if (cls && cls !== b.grade && cls !== cls_(b.grade, b.room)) return false;
    var has = !!(ms[b.log_id] && ms[b.log_id].length);
    if (filter === 'only' && has) return false;
    if (filter === 'meas' && !has) return false;
    if (q) { var s = stu[b.student_id] || {}; if ((b.student_id + ' ' + fullName_(s) + ' ' + b.item_name).toLowerCase().indexOf(q) < 0) return false; }
    return true;
  }).map(function (b) {
    var s = stu[b.student_id] || {}, d = docs[b.log_id];
    return { log_id: b.log_id, date: b.date, student_id: b.student_id, name: fullName_(s) || b.student_id, cls: cls_(b.grade, b.room), item: b.item_name,
             points: Math.abs(num_(b.points)), measures: ms[b.log_id] || [], doc_no: d ? d.doc_no : '', filled: !!(d && d.kind === 'บพ' && d.behavior),
             printed_at: d ? d.printed_at : '' };
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.cls.localeCompare(b.cls, 'th', { numeric: true })); });
  return { rows: list.slice(0, 1000), total: list.length, signers: docSigners_() };
}

/** คะแนนก่อน/หลังรายการนี้ (นับเฉพาะช่วงชั้นเดียวกัน ตามลำดับเวลาที่บันทึก) */
function scoreAround_(log) {
  var base = num_(cfg_('BASE_SCORE'), 100), sum = 0;
  rows_('BehaviorLog').forEach(function (b) {
    if (b.student_id !== log.student_id || b.stage !== log.stage || b.status === 'void') return;
    if (b.recorded_at < log.recorded_at || (b.recorded_at === log.recorded_at && b.log_id <= log.log_id)) sum += num_(b.points);
  });
  var after = base + sum;
  return { before: after - num_(log.points), after: after };
}

function advisorsOf_(grade, room) {
  var c = cls_(grade, room);
  return rows_('Users_Shield').filter(function (r) {
    return bool_(r.shield_active || 'TRUE') && splitList_(r.shield_role).indexOf('advisor') >= 0 && splitList_(r.room_scope).indexOf(c) >= 0;
  }).map(function (r) { return r.display_name; });
}

/** ข้อมูลครบสำหรับฟอร์ม/พิมพ์เอกสาร */
function reportDoc_(p) {
  var log = rows_('BehaviorLog').filter(function (b) { return b.log_id === p.log_id; })[0];
  if (!log || log.status === 'void') throw err_('NOTFOUND', 'ไม่พบรายการคะแนนนี้ หรือถูกยกเลิกแล้ว');
  var s = studentMap_()[log.student_id] || {};
  var meas = rows_('MeasureLog').filter(function (m) { return m.log_id === log.log_id && m.status !== 'void'; })
    .map(function (m) { return { name: m.name, start: m.start_date, end: m.end_date, days: num_(m.days) }; });
  var doc = rows_('BehaviorDocs').filter(function (d) { return d.log_id === log.log_id; })[0] || null;
  var sc = scoreAround_(log), cert = certOf_(sc.after, certRules_());
  var out = {
    log_id: log.log_id, kind: meas.length ? 'บพ' : 'รห', date: log.date, year: log.year, term: log.term, stage: log.stage,
    student: { id: log.student_id, name: fullName_(s), grade: log.grade, room: log.room, number: s.number || '', type: s.student_type || STUDENT_TYPES[0],
               guardian_name: s.guardian_name || '', guardian_relation: s.guardian_relation || '', phone: s.parent_phone || '',
               advisors: advisorsOf_(log.grade, log.room) },
    item: log.item_name, category: log.category, points: Math.abs(num_(log.points)), note: log.note, recorded_by: log.recorded_by, recorded_at: log.recorded_at,
    before: sc.before, after: sc.after, cert: cert.label, measures: meas, signers: docSigners_(), doc: null
  };
  if (doc) {
    var o = {}; Object.keys(doc).forEach(function (k) { if (k !== '_row') o[k] = doc[k]; });
    try { o.signers = JSON.parse(doc.signers || '[]'); } catch (e) { o.signers = []; }
    out.doc = o;
  }
  return out;
}

function nextDocNo_(kind, year) {
  var n = 0;
  rows_('BehaviorDocs').forEach(function (d) {
    if (d.kind !== kind || d.year !== year) return;
    var m = String(d.doc_no).match(/\/(\d+)$/); if (m) n = Math.max(n, Number(m[1]));
  });
  return kind + '. ' + year + '/' + ('000' + (n + 1)).slice(-4);
}

/** บันทึกเอกสาร (สร้างเลขที่ครั้งแรก) · บพ. ต้องมีรายละเอียดพฤติกรรม · print=true บันทึกเวลาพิมพ์ */
function docSave_(u, p) {
  var info = reportDoc_(p), kind = info.kind, stamp = now_();
  var signers = cleanSigners_(p.signers);
  if (!signers.filter(function (s) { return s.on; }).length) throw err_('INPUT', 'กรุณาเลือกผู้ลงนามอย่างน้อย 1 ท่าน');
  var f = { incident_date: normDate_(p.incident_date) || info.date, incident_time: str_(p.incident_time).slice(0, 30), place: str_(p.place).slice(0, 120),
            behavior: str_(p.behavior).slice(0, 2000), reporter: str_(p.reporter).slice(0, 160), comment: str_(p.comment).slice(0, 1000),
            guardian_name: str_(p.guardian_name).slice(0, 120), guardian_relation: str_(p.guardian_relation).slice(0, 60) };
  if (kind === 'บพ' && f.behavior.length < 5) throw err_('INPUT', 'กรุณากรอกรายละเอียดพฤติกรรม');
  var res = lock_(function () {
    dirty_('BehaviorDocs');
    var cur = rows_('BehaviorDocs').filter(function (d) { return d.log_id === info.log_id; })[0];
    var o = Object.assign({}, cur || {}, kind === 'บพ' ? f : {}, {
      log_id: info.log_id, kind: kind, student_id: info.student.id, year: info.year, signers: JSON.stringify(signers),
      updated_by: by_(u), updated_at: stamp
    });
    if (!cur) { o.doc_no = nextDocNo_(kind, info.year); o.created_by = by_(u); o.created_at = stamp; }
    if (p.print) o.printed_at = stamp;
    if (cur) updateRows_('BehaviorDocs', [o]); else append_('BehaviorDocs', [o]);
    return o;
  });
  // อัปเดตชื่อผู้ปกครองในข้อมูลนักเรียน (ถ้าเลือก)
  if (kind === 'บพ' && p.updateGuardian && can_(u, 'student.edit') &&
      (f.guardian_name !== info.student.guardian_name || f.guardian_relation !== info.student.guardian_relation)) {
    studentSave_(u, { id: info.student.id, guardian_name: f.guardian_name, guardian_relation: f.guardian_relation, reason: 'แก้จากบันทึกพฤติกรรม ' + res.doc_no });
  }
  audit_(by_(u), 'docSave', { doc: res.doc_no, log: info.log_id, print: !!p.print });
  var out = reportDoc_(p);
  out.printedAt = stamp;
  return out;
}
