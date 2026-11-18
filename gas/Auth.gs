/********************************************************************
 * Auth.gs — การเข้าสู่ระบบ 3 ทาง + session + กันการเดารหัส
 *  ก. บัญชี Google @kjst.ac.th (ตรวจ ID token กับ Google)
 *  ข. รหัสบุคลากร + รหัสผ่าน (ตรวจ PBKDF2 กับ Staff_Master — สูตรเดียวกับ e-Score)
 *  ค. นักเรียน/ผู้ปกครอง: เลขบัตรประชาชน + วันเกิด (HMAC-SHA256 + pepper)
 ********************************************************************/

var FAIL_LIMIT = 5, FAIL_LOCK_SEC = 900;

/* ===== PBKDF2-HMAC-SHA256 — คัดลอกจาก Auth.gs ของ KJST e-Score (ห้ามแก้สูตร) =====
 * iterations 500, dkLen 32 bytes, salt (hex 32 ตัว) ใช้เป็นข้อความ UTF-8 ตรง ๆ ไม่ได้ decode hex
 * ทดสอบ: pbkdf2_('password','salt',4096,32) = c5e478d5…aa98134a (RFC 7914 test vector) */
var PBKDF2_ITERATIONS = 500;
var PBKDF2_DKLEN = 32;

function hmacSha256Bytes_(keyBytes, msgBytes) {
  var sig = Utilities.computeHmacSha256Signature(msgBytes, keyBytes);
  var out = [];
  for (var i = 0; i < sig.length; i++) out.push((sig[i] + 256) % 256);
  return out;
}
function strToBytes_(s) {
  return Utilities.newBlob(String(s)).getBytes().map(function (b) { return (b + 256) % 256; });
}
function pbkdf2_(password, salt, iterations, dkLen) {
  var pw = strToBytes_(password), saltBytes = strToBytes_(salt), hLen = 32;
  var numBlocks = Math.ceil(dkLen / hLen), out = [];
  for (var block = 1; block <= numBlocks; block++) {
    var blockIdx = [(block >>> 24) & 0xff, (block >>> 16) & 0xff, (block >>> 8) & 0xff, block & 0xff];
    var u = hmacSha256Bytes_(pw, saltBytes.concat(blockIdx));
    var t = u.slice();
    for (var i = 1; i < iterations; i++) {
      u = hmacSha256Bytes_(pw, u);
      for (var j = 0; j < hLen; j++) t[j] ^= u[j];
    }
    out = out.concat(t);
  }
  out = out.slice(0, dkLen);
  var hex = '';
  for (var k = 0; k < out.length; k++) { var b = out[k]; hex += (b < 16 ? '0' : '') + b.toString(16); }
  return hex;
}
function verifyPassword_(salt, password, storedHash) {
  var computed = pbkdf2_(String(password), String(salt), PBKDF2_ITERATIONS, PBKDF2_DKLEN);
  var stored = String(storedHash).toLowerCase();
  if (computed.length !== stored.length) return false;
  var diff = 0;
  for (var i = 0; i < computed.length; i++) diff |= (computed.charCodeAt(i) ^ stored.charCodeAt(i));
  return diff === 0;
}
function selfTestPbkdf2() {
  var got = pbkdf2_('password', 'salt', 4096, 32);
  var ok = got === 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a';
  Logger.log('PBKDF2 self-test: ' + (ok ? 'PASS' : 'FAIL ' + got));
  return ok;
}

/* ===== กันการเดารหัส ===== */
function failKey_(kind, id) { return 'FAIL_' + kind + '_' + sha256_(String(id).toLowerCase()).slice(0, 24); }
function checkLocked_(kind, id) {
  var n = Number(cache_().get(failKey_(kind, id)) || 0);
  if (n >= FAIL_LIMIT) throw err_('LOCKED', 'กรอกผิดเกิน ' + FAIL_LIMIT + ' ครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
}
function addFail_(kind, id) {
  var k = failKey_(kind, id), n = Number(cache_().get(k) || 0) + 1;
  cache_().put(k, String(n), FAIL_LOCK_SEC);
  return FAIL_LIMIT - n;
}
function clearFail_(kind, id) { cache_().remove(failKey_(kind, id)); }

/* ===== session ===== */
function sessionTtl_() { return Math.min(21600, Math.max(600, cfgNum_('SESSION_HOURS') * 3600 || 21600)); }
function newSession_(data) {
  var token = randomHex_(48);
  data.issued = now_();
  cache_().put('S_' + token, JSON.stringify(data), sessionTtl_());
  return token;
}
function getSession_(token) {
  if (!token || !/^[0-9a-f]{48}$/.test(String(token))) return null;
  var v = cache_().get('S_' + token);
  if (!v) return null;
  cache_().put('S_' + token, v, sessionTtl_());   // ต่ออายุเมื่อใช้งาน
  return JSON.parse(v);
}
function dropSession_(token) { if (token) cache_().remove('S_' + token); }

/* ===== ข้อมูลบุคลากรจาก Users กลาง (อ่านอย่างเดียว) ===== */
function masterStaff_() {
  if (MEMO_._master) return MEMO_._master;
  MEMO_._master = readExternal_(fileId_('MASTER'), 'Staff_Master');
  return MEMO_._master;
}

/** สร้าง session ของบุคลากรจากแถว Users_Shield */
function staffSession_(u, via) {
  var roles = splitList_(u.shield_role).filter(function (r) { return ROLES.indexOf(r) >= 0; });
  if (!roles.length) throw err_('PERM', 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน KJST Shield กรุณาติดต่อผู้ดูแลระบบ');
  if (!bool_(u.shield_active)) throw err_('PERM', 'บัญชีนี้ถูกปิดการใช้งานใน KJST Shield');
  if (!bool_(u.master_active)) throw err_('PERM', 'บัญชีนี้ไม่อยู่ในสถานะใช้งานในฐานข้อมูลบุคลากรกลาง');
  var user = {
    kind: 'staff', id: u.staff_id, name: u.display_name, email: u.email, roles: roles,
    grades: splitList_(u.grade_scope).map(normGrade_).filter(Boolean),
    rooms: splitList_(u.room_scope).map(function (x) { var m = x.match(/(\d)\s*\/\s*(\d+)/); return m ? 'ม.' + m[1] + '/' + Number(m[2]) : ''; }).filter(Boolean),
    via: via
  };
  try { updateRows_('Users_Shield', [Object.assign({}, u, { last_login: now_() })]); } catch (e) {}
  return { session: newSession_(user), user: publicUser_(user) };
}

function publicUser_(u) {
  if (u.kind === 'student') return { kind: 'student', id: u.id, name: u.name };
  return {
    kind: 'staff', id: u.id, name: u.name, email: u.email, roles: u.roles,
    roleNames: u.roles.map(function (r) { return ROLE_TH[r] || r; }),
    grades: u.grades, rooms: u.rooms, perms: permsOf_(u)
  };
}

/* ===== ก. Google ===== */
function loginGoogle_(p) {
  var tok = String(p.idToken || '');
  if (!tok) throw err_('INPUT', 'ไม่พบข้อมูลการเข้าสู่ระบบจาก Google');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw err_('AUTH', 'ตรวจสอบบัญชี Google ไม่ผ่าน กรุณาลองใหม่');
  var t = JSON.parse(res.getContentText());
  var domain = String(cfg_('SCHOOL_DOMAIN') || 'kjst.ac.th');
  if (t.aud !== cfg_('GOOGLE_CLIENT_ID')) throw err_('AUTH', 'Client ID ไม่ตรงกับที่ตั้งค่าไว้');
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(t.iss) < 0) throw err_('AUTH', 'ผู้ออก token ไม่ถูกต้อง');
  if (String(t.email_verified) !== 'true') throw err_('AUTH', 'อีเมลยังไม่ได้ยืนยันกับ Google');
  if (Number(t.exp) * 1000 < Date.now()) throw err_('AUTH', 'การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่');
  var email = String(t.email || '').toLowerCase();
  if (t.hd !== domain && !email.endsWith('@' + domain)) throw err_('AUTH', 'ใช้ได้เฉพาะบัญชี @' + domain);
  var u = rows_('Users_Shield').filter(function (r) { return String(r.email).toLowerCase() === email; })[0];
  if (!u) throw err_('PERM', 'บัญชี ' + email + ' ยังไม่ได้รับสิทธิ์ใช้งาน KJST Shield กรุณาติดต่อผู้ดูแลระบบ');
  var out = staffSession_(u, 'google');
  audit_(u.staff_id, 'login', 'google');
  return out;
}

/* ===== ข. รหัสบุคลากร + รหัสผ่าน ===== */
function loginPassword_(p) {
  var username = String(p.username || '').trim(), password = String(p.password || '');
  if (!username || !password) throw err_('INPUT', 'กรุณากรอกรหัสบุคลากรและรหัสผ่าน');
  checkLocked_('pw', username);
  var key = username.toLowerCase();
  var m = masterStaff_().filter(function (r) {
    return String(r.staff_id).toLowerCase() === key || String(r.email).toLowerCase() === key;
  })[0];
  var bad = function () {
    var left = addFail_('pw', username);
    throw err_('AUTH', 'รหัสบุคลากรหรือรหัสผ่านไม่ถูกต้อง' + (left > 0 && left <= 2 ? ' (เหลืออีก ' + left + ' ครั้ง)' : ''));
  };
  if (!m || !m.password_hash || !m.salt) bad();
  if (!verifyPassword_(m.salt, password, m.password_hash)) bad();
  clearFail_('pw', username);
  if (!bool_(m.is_active)) throw err_('PERM', 'บัญชีนี้ไม่อยู่ในสถานะใช้งานในฐานข้อมูลบุคลากรกลาง');
  if (bool_(m.must_change_password)) throw err_('PERM', 'กรุณาเปลี่ยนรหัสผ่านที่ระบบ e-Score ก่อน หรือเข้าสู่ระบบด้วยบัญชี Google');
  var u = rows_('Users_Shield').filter(function (r) { return String(r.staff_id).toLowerCase() === String(m.staff_id).toLowerCase(); })[0];
  if (!u) throw err_('PERM', 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน KJST Shield กรุณาติดต่อผู้ดูแลระบบ');
  var out = staffSession_(u, 'password');
  audit_(u.staff_id, 'login', 'password');
  return out;
}

/* ===== ค. นักเรียน/ผู้ปกครอง ===== */
function pepper_() {
  var p = props_().getProperty('STUDENT_PEPPER');
  if (!p) { p = randomHex_(64); props_().setProperty('STUDENT_PEPPER', p); }
  return p;
}
/** dobBE = 'yyyy-mm-dd' แบบ พ.ศ. */
function studentAuthHash_(nid13, dobBE) { return hmac_(pepper_(), nid_(nid13) + '|' + dobBE); }

function loginStudent_(p) {
  var nid = nid_(p.nid), dob = normDob_(p.dob || ((p.day || '') + '/' + (p.month || '') + '/' + (p.year || '')));
  if (nid.length !== 13) throw err_('INPUT', 'กรุณากรอกเลขประจำตัวประชาชน 13 หลัก');
  if (!dob) throw err_('INPUT', 'กรุณากรอกวันเดือนปีเกิดให้ครบ (ปี พ.ศ.)');
  checkLocked_('st', nid);
  var h = studentAuthHash_(nid, dob);
  var s = rows_('Students').filter(function (r) { return r.auth_hash === h; })[0];
  if (!s) {
    var left = addFail_('st', nid);
    throw err_('AUTH', 'ข้อมูลไม่ตรงกับทะเบียนนักเรียน กรุณาตรวจสอบเลขประจำตัวประชาชนและวันเกิด' + (left > 0 && left <= 2 ? ' (เหลืออีก ' + left + ' ครั้ง)' : ''));
  }
  clearFail_('st', nid);
  var user = { kind: 'student', id: s.student_id, name: fullName_(s) };
  return { session: newSession_(user), user: publicUser_(user) };
}
