/********************************************************************
 * Perms.gs — สิทธิ์ตามตาราง Permissions และขอบเขตข้อมูลตามบทบาท
 ********************************************************************/

function permTable_() {
  if (MEMO_._perm) return MEMO_._perm;
  var c = cache_().get('PERM_TABLE');
  if (c) { MEMO_._perm = JSON.parse(c); return MEMO_._perm; }
  var t = {};
  rows_('Permissions').forEach(function (r) {
    if (!r.action) return;
    t[r.action] = ROLES.filter(function (role) { return bool_(r[role]); });
  });
  cache_().put('PERM_TABLE', JSON.stringify(t), 600);
  MEMO_._perm = t;
  return t;
}
function clearPermCache_() { cache_().remove('PERM_TABLE'); delete MEMO_._perm; }

function can_(u, action) {
  if (!u || u.kind !== 'staff') return false;
  var allowed = permTable_()[action] || [];
  return u.roles.some(function (r) { return allowed.indexOf(r) >= 0; });
}
function permsOf_(u) {
  var t = permTable_();
  return Object.keys(t).filter(function (a) { return can_(u, a); });
}
function need_(u, action) {
  if (!can_(u, action)) throw err_('PERM', 'ไม่มีสิทธิ์ใช้งานส่วนนี้');
}

/** ขอบเขตข้อมูล: ผู้บริหาร แอดมินบันทึกคะแนน ผู้ดูแลระบบ = ทั้งโรงเรียน, หัวหน้าระดับ = ชั้นของตน, ครูที่ปรึกษา = ห้องของตน */
function scope_(u) {
  if (u.kind !== 'staff') return { all: false, grades: [], rooms: [] };
  var all = u.roles.some(function (r) { return r === 'executive' || r === 'score_admin' || r === 'sysadmin'; });
  return {
    all: all,
    grades: u.roles.indexOf('head') >= 0 ? u.grades : [],
    rooms: u.roles.indexOf('advisor') >= 0 ? u.rooms : []
  };
}
function inScope_(sc, grade, room) {
  return sc.all || sc.grades.indexOf(grade) >= 0 || sc.rooms.indexOf(cls_(grade, room)) >= 0;
}
/** ขอบเขตการ "ดำเนินการ" (ติดตาม/เยี่ยมบ้าน/ส่งต่อ) — เฉพาะชั้น/ห้องของตน */
function careScope_(u) { return { all: false, grades: u.roles.indexOf('head') >= 0 ? u.grades : [], rooms: u.roles.indexOf('advisor') >= 0 ? u.rooms : [] }; }
