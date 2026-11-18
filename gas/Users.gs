/********************************************************************
 * Users.gs — ซิงก์บุคลากรจาก Users กลาง และจัดการบทบาท
 ********************************************************************/

var SYNC_COLS = ['staff_id', 'email', 'display_name', 'staff_type', 'position', 'department', 'master_active', 'synced_at'];

function eligibleType_(t) { t = String(t || ''); return t === 'ผู้บริหาร' || t.indexOf('ครู') >= 0; }

/** ซิงก์จาก Staff_Master (ผู้ดูแลระบบกดเอง) — แก้เฉพาะคอลัมน์กลุ่มซิงก์ */
function syncUsers_(by) {
  var master = masterStaff_();
  var hr = [];
  try { hr = readExternal_(fileId_('MASTER'), 'Users_HR'); } catch (e) {}
  var hrMap = {}; hr.forEach(function (h) { hrMap[String(h.staff_id).toUpperCase()] = h; });

  var cur = {}; rows_('Users_Shield').forEach(function (r) { cur[String(r.staff_id).toUpperCase()] = r; });
  var stamp = now_(), upd = [], add = [], conflicts = [], seen = {};

  master.forEach(function (m) {
    var id = String(m.staff_id || '').toUpperCase();
    if (!id) return;
    var h = hrMap[id], okMaster = eligibleType_(m.staff_type);
    var okHr = h ? (eligibleType_(h.staff_type) || h.hr_role === 'executive') : null;
    if (h && okHr !== okMaster) conflicts.push({ staff_id: id, name: m.display_name, master_type: m.staff_type, hr_type: h.staff_type, hr_role: h.hr_role });
    if (!okMaster) return;
    seen[id] = 1;
    var o = {
      staff_id: id, email: String(m.email || '').toLowerCase(), display_name: m.display_name || fullName_(m),
      staff_type: m.staff_type, position: m.position, department: m.department,
      master_active: bool_(m.is_active) ? 'TRUE' : 'FALSE', synced_at: stamp
    };
    if (cur[id]) upd.push(Object.assign({}, cur[id], o));
    else add.push(Object.assign(o, { shield_role: '', grade_scope: '', room_scope: '', shield_active: 'TRUE' }));
  });
  var deact = 0;
  Object.keys(cur).forEach(function (id) {
    if (!seen[id] && bool_(cur[id].master_active)) { upd.push(Object.assign({}, cur[id], { master_active: 'FALSE', synced_at: stamp })); deact++; }
  });
  lock_(function () { updateRows_('Users_Shield', upd); append_('Users_Shield', add); });
  var res = { added: add.length, updated: upd.length - deact, deactivated: deact, conflicts: conflicts };
  audit_(by, 'usersSync', { added: res.added, updated: res.updated, deactivated: deact, conflicts: conflicts.length });
  return res;
}

function addRoles_(cur, roles) { return uniq_(splitList_(cur).concat(roles)).join(','); }

/** ตั้งต้นบทบาท: ผู้บริหาร (staff_type), ครูที่ปรึกษา/หัวหน้าระดับ (_ผู้รับแจ้งเตือน ของ E-Attendance), ผู้ดูแลระบบตั้งต้น
 *  force = false: เติมเฉพาะคนที่ยังไม่มีบทบาท */
function seedRoles_(by, force) {
  var users = rows_('Users_Shield'), byEmail = {}, byId = {};
  users.forEach(function (u) { byEmail[String(u.email).toLowerCase()] = u; byId[u.staff_id] = u; });
  var plan = {};   // staff_id -> {roles:[], grades:[], rooms:[]}
  function P(id) { return plan[id] = plan[id] || { roles: [], grades: [], rooms: [] }; }

  users.forEach(function (u) { if (u.staff_type === 'ผู้บริหาร') P(u.staff_id).roles.push('executive'); });

  var unmatched = [], source = '';
  // 1) ฐานข้อมูลนักเรียนกลาง ชีต "ครูที่ปรึกษา": รหัสครู 1/2 (ตัวเลข → T###), บทบาทพิเศษ = หัวหน้าระดับ
  var adv = [];
  try { adv = readExternal_(fileId_('STUDENTS'), 'ครูที่ปรึกษา'); } catch (e) {}
  var toId = function (c) { c = String(c || '').trim(); if (!c) return ''; return /^\d+$/.test(c) ? 'T' + c : c.toUpperCase(); };
  adv.forEach(function (r) {
    var m = String(r['ชั้น/ห้อง'] || '').match(/ม\.\s*(\d)\s*\/\s*(\d+)/);
    if (!m) return;
    var room = 'ม.' + m[1] + '/' + Number(m[2]), grade = 'ม.' + m[1];
    [r['รหัสครู 1'], r['รหัสครู 2']].map(toId).filter(Boolean).forEach(function (id) {
      if (!byId[id]) { unmatched.push(id + ' (' + room + ')'); return; }
      var p = P(id); p.roles.push('advisor'); p.rooms.push(room);
    });
    if (String(r['บทบาทพิเศษ'] || '').indexOf('หัวหน้าระดับ') >= 0) {
      var hid = toId(String(r['หัวหน้าระดับ (รหัส ชื่อ)'] || '').split(/\s+/)[0]);
      if (hid && byId[hid]) { var hp = P(hid); hp.roles.push('head'); hp.grades.push(grade); }
      else if (hid) unmatched.push(hid + ' (หัวหน้าระดับ ' + grade + ')');
    }
  });
  if (adv.length) source = 'ฐานข้อมูลนักเรียนกลาง (ครูที่ปรึกษา)';

  // 2) สำรอง: E-Attendance ชีต "_ผู้รับแจ้งเตือน" (ใช้เมื่ออ่านข้อ 1 ไม่ได้)
  var src = adv.length ? null : rows_('AttendanceSources').filter(function (s) { return bool_(s.active) && s.file_id; })
    .sort(function (a, b) { return (b.year + b.term).localeCompare(a.year + a.term); })[0];
  if (src) {
    source = 'E-Attendance (_ผู้รับแจ้งเตือน)';
    var rec = [];
    try { rec = readExternal_(src.file_id, '_ผู้รับแจ้งเตือน'); } catch (e) {}
    rec.forEach(function (r) {
      var target = r['ห้อง/ระดับ'] || '', role = r['บทบาท'] || '';
      splitList_(r['อีเมล']).forEach(function (em) {
        var u = byEmail[em.toLowerCase()];
        if (!u) { unmatched.push(em + ' (' + target + ')'); return; }
        var p = P(u.staff_id), m = target.match(/ม\.\s*(\d)\s*\/\s*(\d+)/), g = target.match(/ม\.\s*(\d)/);
        if (role.indexOf('ที่ปรึกษา') >= 0 && m) { p.roles.push('advisor'); p.rooms.push('ม.' + m[1] + '/' + Number(m[2])); }
        else if (role.indexOf('หัวหน้าระดับ') >= 0 && g) { p.roles.push('head'); p.grades.push('ม.' + g[1]); }
      });
    });
  }
  SEED_SYSADMINS.forEach(function (id) { if (byId[id]) P(id).roles.push('sysadmin'); });

  var upd = [], stamp = now_();
  Object.keys(plan).forEach(function (id) {
    var u = byId[id]; if (!u) return;
    if (!force && splitList_(u.shield_role).length) return;
    var p = plan[id];
    upd.push(Object.assign({}, u, {
      shield_role: addRoles_(force ? u.shield_role : '', uniq_(p.roles)),
      grade_scope: uniq_(splitList_(u.grade_scope).concat(p.grades)).join(','),
      room_scope: uniq_(splitList_(u.room_scope).concat(p.rooms)).join(','),
      shield_active: 'TRUE', assigned_by: by + ' (ตั้งต้น)', assigned_at: stamp
    }));
  });
  lock_(function () { updateRows_('Users_Shield', upd); });
  audit_(by, 'usersSeedRoles', { users: upd.length, unmatched: unmatched.length, source: source });
  return { updated: upd.length, unmatched: unmatched, source: source };
}

function usersList_() {
  return rows_('Users_Shield').map(function (u) {
    return {
      staff_id: u.staff_id, name: u.display_name, email: u.email, staff_type: u.staff_type, position: u.position, department: u.department,
      master_active: bool_(u.master_active), roles: splitList_(u.shield_role), grade_scope: u.grade_scope, room_scope: u.room_scope,
      active: bool_(u.shield_active), assigned_by: u.assigned_by, assigned_at: u.assigned_at, last_login: u.last_login, note: u.note
    };
  }).sort(function (a, b) { return a.staff_id.localeCompare(b.staff_id); });
}

function usersSave_(by, p) {
  var id = String(p.staff_id || '').toUpperCase();
  var u = rows_('Users_Shield').filter(function (r) { return r.staff_id === id; })[0];
  if (!u) throw err_('NOTFOUND', 'ไม่พบผู้ใช้ ' + id);
  var roles = uniq_([].concat(p.roles || [])).filter(function (r) { return ROLES.indexOf(r) >= 0; });
  var grades = splitList_(p.grade_scope).map(normGrade_).filter(Boolean);
  var rooms = splitList_(p.room_scope).map(function (x) { var m = x.match(/(\d)\s*\/\s*(\d+)/); return m ? 'ม.' + m[1] + '/' + Number(m[2]) : ''; }).filter(Boolean);
  if (roles.indexOf('head') >= 0 && !grades.length) throw err_('INPUT', 'หัวหน้าระดับต้องระบุระดับชั้น');
  if (roles.indexOf('advisor') >= 0 && !rooms.length) throw err_('INPUT', 'ครูที่ปรึกษาต้องระบุห้อง เช่น ม.1/1');
  if (id === by && splitList_(u.shield_role).indexOf('sysadmin') >= 0 && roles.indexOf('sysadmin') < 0) throw err_('INPUT', 'ไม่สามารถถอดสิทธิ์ผู้ดูแลระบบของตนเองได้');
  var next = Object.assign({}, u, {
    shield_role: roles.join(','), grade_scope: grades.join(','), room_scope: rooms.join(','),
    shield_active: p.active === false ? 'FALSE' : 'TRUE', note: p.note !== undefined ? String(p.note) : u.note,
    assigned_by: by, assigned_at: now_()
  });
  lock_(function () { updateRows_('Users_Shield', [next]); });
  audit_(by, 'usersSave', { staff_id: id, roles: next.shield_role, grades: next.grade_scope, rooms: next.room_scope, active: next.shield_active });
  return true;
}
