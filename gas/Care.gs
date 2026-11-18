/********************************************************************
 * Care.gs — บันทึกการติดตาม เยี่ยมบ้าน และส่งต่อ (หัวหน้าระดับ/ครูที่ปรึกษา)
 ********************************************************************/

function careOf_(id) {
  return rows_('CareLogs').filter(function (c) { return c.student_id === id; }).map(careOut_)
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
}
function careOut_(c) {
  return { care_id: c.care_id, date: c.date, student_id: c.student_id, cls: cls_(c.grade, c.room), kind: c.kind, detail: c.detail,
           referred_to: c.referred_to, status: c.status, by: c.recorded_by, at: c.recorded_at, updated_by: c.updated_by, updated_at: c.updated_at };
}

function careList_(u, p) {
  var sc = scope_(u), stu = studentMap_();
  var list = rows_('CareLogs').filter(function (c) { return inScope_(sc, c.grade, c.room); });
  if (p.status) list = list.filter(function (c) { return c.status === p.status; });
  return list.map(function (c) { var o = careOut_(c); var s = stu[c.student_id]; o.name = s ? fullName_(s) : c.student_id; return o; })
    .sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : (a.at < b.at ? 1 : -1)); }).slice(0, 500);
}

function careAdd_(u, p) {
  var id = sid_(p.student_id), s = studentMap_()[id];
  if (!s) throw err_('NOTFOUND', 'ไม่พบนักเรียน');
  if (!inScope_(careScope_(u), s.grade, s.room)) throw err_('PERM', 'บันทึกได้เฉพาะนักเรียนในชั้น/ห้องที่รับผิดชอบ');
  var kind = CARE_KINDS.indexOf(p.kind) >= 0 ? p.kind : '';
  if (!kind) throw err_('INPUT', 'กรุณาเลือกประเภท: ' + CARE_KINDS.join(' / '));
  var detail = String(p.detail || '').trim();
  if (detail.length < 3) throw err_('INPUT', 'กรุณาบันทึกรายละเอียด');
  if (kind === 'ส่งต่อ' && !String(p.referred_to || '').trim()) throw err_('INPUT', 'กรุณาระบุว่าส่งต่อถึงใคร/หน่วยงานใด');
  var date = normDate_(p.date) || today_();
  var o = {
    care_id: 'C' + Date.now().toString(36), date: date, student_id: id, grade: s.grade, room: s.room, kind: kind,
    detail: detail.slice(0, 2000), referred_to: String(p.referred_to || '').trim().slice(0, 200),
    status: CARE_STATUS.indexOf(p.status) >= 0 ? p.status : 'ดำเนินการ',
    recorded_by: u.name + ' (' + u.id + ')', recorded_at: now_()
  };
  lock_(function () { append_('CareLogs', [o]); });
  return { care_id: o.care_id };
}

function careUpdate_(u, p) {
  return lock_(function () {
    dirty_('CareLogs');
    var c = rows_('CareLogs').filter(function (x) { return x.care_id === p.care_id; })[0];
    if (!c) throw err_('NOTFOUND', 'ไม่พบรายการ');
    if (!inScope_(careScope_(u), c.grade, c.room)) throw err_('PERM', 'แก้ไขได้เฉพาะนักเรียนในชั้น/ห้องที่รับผิดชอบ');
    var next = Object.assign({}, c, { updated_by: u.name + ' (' + u.id + ')', updated_at: now_() });
    if (CARE_STATUS.indexOf(p.status) >= 0) next.status = p.status;
    if (p.append) next.detail = (c.detail + '\n[' + today_() + '] ' + String(p.append).trim()).slice(0, 4000);
    updateRows_('CareLogs', [next]);
    return true;
  });
}
