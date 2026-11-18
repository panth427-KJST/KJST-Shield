/********************************************************************
 * Util.gs — ฟังก์ชันช่วยทั่วไป
 ********************************************************************/

/** ข้อผิดพลาดที่ส่งกลับหน้าเว็บ: code = AUTH | PERM | INPUT | NOTFOUND | LOCKED | SERVER */
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }

function str_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return String(v).trim();
}
function bool_(v) { var s = String(v).trim().toUpperCase(); return s === 'TRUE' || s === 'Y' || s === '1' || s === 'YES' || s === 'ใช่'; }
function num_(v, d) { var n = Number(v); return (v === '' || v === null || isNaN(n)) ? (d === undefined ? 0 : d) : n; }
function round1_(x) { return Math.round(x * 10) / 10; }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function addDays_(iso, n) {
  var p = iso.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2] + n);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** รหัสนักเรียน 5 หลัก (E-Attendance ใช้ 4 หลัก, DMC ใช้ 5 หลัก) */
function sid_(v) {
  var d = String(v === null || v === undefined ? '' : v).replace(/\.0+$/, '').replace(/\D/g, '');
  if (!d) return '';
  return d.length < 5 ? ('00000' + d).slice(-5) : d;
}
function nid_(v) { return String(v || '').replace(/\D/g, ''); }
function normGrade_(g) { var d = String(g || '').replace(/\.0+$/, '').replace(/\D/g, ''); return d ? 'ม.' + Number(d) : ''; }
function normRoom_(r) { var d = String(r || '').replace(/\.0+$/, '').replace(/\D/g, ''); return d ? String(Number(d)) : ''; }
function gnum_(g) { return Number(String(g).replace(/\D/g, '')) || 0; }
function stage_(g) { return gnum_(g) >= 4 ? 'ม.ปลาย' : 'ม.ต้น'; }
function cls_(g, r) { return g + '/' + r; }
function fullName_(s) { return ((s.prefix || '') + (s.first_name || '') + ' ' + (s.last_name || '')).trim(); }

/** วันที่จากหน้าเว็บ yyyy-mm-dd (ค.ศ. หรือ พ.ศ.) → yyyy-mm-dd ค.ศ. */
function normDate_(v) {
  var m = String(v || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return '';
  var y = +m[1]; if (y > 2400) y -= 543;
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** วันเกิด → 'yyyy-mm-dd' แบบ พ.ศ. รับ dd/mm/yyyy, yyyy-mm-dd, Date */
function normDob_(v) {
  var d, m, y;
  if (v instanceof Date) { d = v.getDate(); m = v.getMonth() + 1; y = v.getFullYear(); }
  else {
    var s = String(v || '').trim(), a;
    if ((a = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) { d = +a[1]; m = +a[2]; y = +a[3]; }
    else if ((a = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +a[1]; m = +a[2]; d = +a[3]; }
    else return '';
  }
  if (y < 2400) y += 543;
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12)) return '';
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function hex_(bytes) {
  return bytes.map(function (b) { b = (b + 256) % 256; return (b < 16 ? '0' : '') + b.toString(16); }).join('');
}
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function hmac_(key, s) { return hex_(Utilities.computeHmacSha256Signature(String(s), String(key), Utilities.Charset.UTF_8)); }
function randomHex_(n) { var s = ''; while (s.length < n) s += Utilities.getUuid().replace(/-/g, ''); return s.slice(0, n); }

function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }

function lock_(fn) {
  var l = LockService.getScriptLock();
  if (!l.tryLock(30000)) throw err_('LOCKED', 'ระบบกำลังบันทึกข้อมูลของผู้ใช้อื่น กรุณาลองใหม่อีกครั้ง');
  try { return fn(); } finally { l.releaseLock(); }
}

/** cache ข้อมูลใหญ่แบบแบ่งชิ้น (CacheService จำกัด 100KB ต่อ key) */
function cachePutBig_(key, obj, sec) {
  var s = JSON.stringify(obj), size = 90000, n = Math.ceil(s.length / size), map = {};
  for (var i = 0; i < n; i++) map[key + '_' + i] = s.substr(i * size, size);
  map[key + '_n'] = String(n);
  try { cache_().putAll(map, sec || 21600); } catch (e) { /* ข้อมูลใหญ่เกินไป ใช้แบบไม่ cache */ }
}
function cacheGetBig_(key) {
  var c = cache_(), n = Number(c.get(key + '_n'));
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  try { return JSON.parse(s); } catch (e) { return null; }
}

function audit_(by, action, detail) {
  try { append_('AuditLog', [{ at: now_(), by: by || 'ระบบ', action: action, detail: typeof detail === 'string' ? detail : JSON.stringify(detail || '') }]); }
  catch (e) { Logger.log('audit fail: ' + e.message); }
}

function splitList_(v) { return String(v || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }
function uniq_(a) { var o = {}; return a.filter(function (x) { if (o[x]) return false; o[x] = 1; return true; }); }
