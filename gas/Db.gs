/********************************************************************
 * Db.gs — อ่าน/เขียน Google Sheet ตามชื่อหัวคอลัมน์
 *  - ไม่เปลี่ยนชื่อหรือลบชีตเอง ถ้าคอลัมน์ขาดจะเพิ่มต่อท้าย
 *  - ทุกคอลัมน์เป็นรูปแบบข้อความ (@) เพื่อรักษาเลข 0 นำหน้า
 *  - ข้อมูลที่อ่านแล้วจำไว้ตลอดการเรียกครั้งนั้น (MEMO)
 ********************************************************************/

var BOOKS_ = {}, SHEETS_ = {}, HEADERS_ = {}, MEMO_ = {};

function fileId_(file) { return props_().getProperty(file + '_ID') || IDS[file]; }

function book_(file) {
  if (!BOOKS_[file]) {
    try { BOOKS_[file] = SpreadsheetApp.openById(fileId_(file)); }
    catch (e) { throw err_('SERVER', 'เปิดไฟล์ ' + file + ' ไม่ได้ (' + e.message + ') ตรวจสอบรหัสไฟล์และสิทธิ์ของบัญชีเจ้าของสคริปต์'); }
  }
  return BOOKS_[file];
}

/** คืนชีตตาม SCHEMA (สร้าง/เติมหัวคอลัมน์ให้ถ้าจำเป็น) */
function sheet_(name) {
  if (SHEETS_[name]) return SHEETS_[name];
  var def = SCHEMA[name];
  if (!def) throw err_('SERVER', 'ไม่รู้จักชีต ' + name);
  var ss = book_(def.file), s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, s.getMaxRows(), Math.max(def.cols.length, 1)).setNumberFormat('@');
    s.getRange(1, 1, 1, def.cols.length).setValues([def.cols]);
    styleHeader_(s, name, def.cols);
    s.setFrozenRows(1);
  } else {
    var lastCol = Math.max(s.getLastColumn(), 1);
    var cur = s.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
    var missing = def.cols.filter(function (c) { return cur.indexOf(c) < 0; });
    if (cur.join('') === '') {
      s.getRange(1, 1, 1, def.cols.length).setValues([def.cols]);
      styleHeader_(s, name, def.cols);
      s.setFrozenRows(1);
    } else if (missing.length) {
      var start = s.getLastColumn() + 1;
      if (s.getMaxColumns() < start + missing.length - 1) s.insertColumnsAfter(s.getMaxColumns(), start + missing.length - 1 - s.getMaxColumns());
      s.getRange(1, start, s.getMaxRows(), missing.length).setNumberFormat('@');
      s.getRange(1, start, 1, missing.length).setValues([missing]);
      styleHeader_(s, name, missing, start);
    }
  }
  SHEETS_[name] = s;
  return s;
}

function styleHeader_(s, name, cols, startCol) {
  var gold = (SCHEMA[name] && SCHEMA[name].gold) || [];
  var start = startCol || 1;
  cols.forEach(function (c, i) {
    var cell = s.getRange(1, start + i);
    var isGold = gold.indexOf(c) >= 0;
    cell.setFontWeight('bold').setBackground(isGold ? '#C9A227' : '#12245A').setFontColor(isGold ? '#1F1A08' : '#FFFFFF');
  });
}

/** หัวคอลัมน์จริงของชีต (ตามตำแหน่งในชีต) */
function headers_(name) {
  if (HEADERS_[name]) return HEADERS_[name];
  var s = sheet_(name), lastCol = Math.max(s.getLastColumn(), 1);
  HEADERS_[name] = s.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  return HEADERS_[name];
}

/** อ่านทุกแถวเป็น object (key = ชื่อหัวคอลัมน์) พร้อม _row = เลขแถวในชีต */
function rows_(name) {
  if (MEMO_[name]) return MEMO_[name];
  var s = sheet_(name), h = headers_(name), n = s.getLastRow() - 1, out = [];
  if (n > 0) {
    var vals = s.getRange(2, 1, n, h.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i], empty = true, o = { _row: i + 2 };
      for (var j = 0; j < h.length; j++) {
        if (!h[j]) continue;
        var v = str_(r[j]); o[h[j]] = v; if (v !== '') empty = false;
      }
      if (!empty) out.push(o);
    }
  }
  MEMO_[name] = out;
  return out;
}

function dirty_(name) { delete MEMO_[name]; }

function toRow_(name, o) {
  return headers_(name).map(function (k) { var v = o[k]; return (v === undefined || v === null) ? '' : (v === true ? 'TRUE' : v === false ? 'FALSE' : String(v)); });
}

/** เพิ่มแถวท้ายชีต */
function append_(name, objs) {
  if (!objs || !objs.length) return 0;
  var s = sheet_(name), h = headers_(name), vals = objs.map(function (o) { return toRow_(name, o); });
  var start = s.getLastRow() + 1, need = start + vals.length - 1;
  if (need > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), need - s.getMaxRows() + 50);
  s.getRange(start, 1, vals.length, h.length).setNumberFormat('@').setValues(vals);
  dirty_(name);
  return vals.length;
}

/** แก้แถวเดิม (obj ต้องมี _row) — ค่าที่ไม่ได้ส่งมาคงเดิม */
function updateRows_(name, objs) {
  if (!objs || !objs.length) return 0;
  var s = sheet_(name), h = headers_(name);
  if (objs.length > 30) {           // แก้หลายแถว: เขียนทั้งตารางครั้งเดียว
    var all = rows_(name), byRow = {};
    objs.forEach(function (o) { byRow[o._row] = o; });
    var merged = all.map(function (r) { return byRow[r._row] ? Object.assign({}, r, byRow[r._row]) : r; });
    writeAll_(name, merged);
    return objs.length;
  }
  objs.forEach(function (o) {
    s.getRange(o._row, 1, 1, h.length).setNumberFormat('@').setValues([toRow_(name, o)]);
  });
  dirty_(name);
  return objs.length;
}

/** เขียนแทนข้อมูลทั้งหมด (หัวคอลัมน์คงเดิม) */
function writeAll_(name, objs) {
  var s = sheet_(name), h = headers_(name), last = s.getLastRow();
  if (last > 1) s.getRange(2, 1, last - 1, h.length).clearContent();
  dirty_(name);
  if (!objs.length) return 0;
  var vals = objs.map(function (o) { return toRow_(name, o); });
  var need = vals.length + 1;
  if (need > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), need - s.getMaxRows() + 50);
  s.getRange(2, 1, vals.length, h.length).setNumberFormat('@').setValues(vals);
  dirty_(name);
  return vals.length;
}

/** upsert ตาม key: แถวที่มีอยู่แก้เฉพาะ field ที่ส่งมา แถวใหม่เพิ่มท้าย */
function upsert_(name, key, objs) {
  var idx = {};
  rows_(name).forEach(function (r) { idx[r[key]] = r; });
  var upd = [], add = [];
  objs.forEach(function (o) {
    var cur = idx[o[key]];
    if (cur) upd.push(Object.assign({}, cur, o, { _row: cur._row }));
    else add.push(o);
  });
  updateRows_(name, upd);
  append_(name, add);
  return { updated: upd.length, added: add.length };
}

/* ---------- Config ---------- */
function cfgAll_() {
  if (MEMO_._cfg) return MEMO_._cfg;
  var o = {};
  CONFIG_DEFAULTS.forEach(function (d) { o[d[0]] = d[1]; });
  rows_('Config').forEach(function (r) { if (r.key) o[r.key] = r.value; });
  MEMO_._cfg = o;
  return o;
}
function cfg_(k) { return cfgAll_()[k]; }
function cfgNum_(k) { return num_(cfg_(k), 0); }
function setCfg_(k, v) { upsert_('Config', 'key', [{ key: k, value: String(v) }]); delete MEMO_._cfg; }
function year_() { return String(cfg_('YEAR')); }
function term_() { return String(cfg_('TERM')); }

/* ---------- อ่านไฟล์ภายนอก (อ่านอย่างเดียว) ---------- */
function readExternal_(fileId, sheetName) {
  var ss = SpreadsheetApp.openById(fileId), s = ss.getSheetByName(sheetName);
  if (!s || s.getLastRow() < 1) return [];
  var v = s.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {}, empty = true;
    for (var j = 0; j < h.length; j++) { if (!h[j]) continue; o[h[j]] = str_(v[i][j]); if (o[h[j]] !== '') empty = false; }
    if (!empty) out.push(o);
  }
  return out;
}
