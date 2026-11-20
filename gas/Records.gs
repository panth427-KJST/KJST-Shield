/********************************************************************
 * Records.gs — แก้ไขข้อมูลย้อนหลัง (เฉพาะแอดมิน: สิทธิ์ records.edit)
 *  แก้ที่ต้นทาง = ไฟล์ KJST e-Attendance ของ "ภาคเรียนปัจจุบัน" เท่านั้น
 *   - การมาเรียน : ช่องวันที่ในชีตห้อง "ม.X/Y"
 *   - การแต่งกาย : ชีต _ตรวจระเบียบ (ยกเลิก = status void ไม่ลบแถว)
 *   - ทรงผม      : ชีต _ตรวจทรงผม (ผ่าน → คัดลอกไปวันตรวจถัดไปที่ยังว่าง และไม่เกินวันนี้)
 *  ทุกช่องที่แก้ → 1 แถวในชีต EditLog (Shield) · กันชนกัน: ค่าเดิมต้องตรงกับที่ผู้ใช้เห็น
 *  หลังบันทึก อัปเดตสถิติใน Shield ของห้อง/วันที่นั้นทันที (ไม่ต้องรอรอบดึงข้อมูล)
 ********************************************************************/

var ATT_LABEL = { '1': '1.มาโรงเรียน', '2': '2.ไปราชการ/อื่นๆ', '3': '3.ลาป่วย/ลากิจ', '4': '4.มาสาย', '5': '5.ขาดเรียน' };
var HAIR_RESULTS = ['ผ่าน', 'ไม่ผ่าน', 'ไม่อยู่'];

/* ---------- ไฟล์ต้นทางของภาคเรียนปัจจุบัน ---------- */
function recSource_() {
  var src = attSources_(true).filter(function (s) { return s.year === year_() && s.term === term_(); })[0];
  if (!src) throw err_('INPUT', 'ยังไม่ได้ตั้งค่าไฟล์ E-Attendance ของภาคเรียน ' + term_() + '/' + year_());
  var ss;
  try { ss = SpreadsheetApp.openById(src.file_id); } catch (e) { throw err_('INPUT', 'เปิดไฟล์ E-Attendance ไม่ได้ — ตรวจสิทธิ์การแก้ไขไฟล์'); }
  return { src: src, ss: ss };
}
function recClasses_() {
  var cm = classMap_(), out = [];
  Object.keys(cm).forEach(function (g) { cm[g].forEach(function (r) { out.push(cls_(g, r)); }); });
  return out;
}
function cellDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return normDate_(str_(v)) || str_(v);
}
function newBatch_() { return Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100); }

/** อ่านชีตห้อง: รายชื่อ + คอลัมน์วันที่ (เฉพาะวันที่ไม่เกินวันนี้) */
function recRoom_(ss, cls) {
  var mm = String(cls || '').match(/^ม\.(\d)\/(\d+)$/);
  if (!mm) throw err_('INPUT', 'กรุณาเลือกห้องเรียน');
  var sh = ss.getSheetByName(cls);
  if (!sh) throw err_('NOTFOUND', 'ไม่พบชีตห้อง ' + cls + ' ในไฟล์ E-Attendance');
  var v = sh.getDataRange().getDisplayValues(), today = today_(), cols = [], students = [];
  for (var c = 3; c < v[0].length; c++) {
    var iso = parseThaiDateLabel_(v[0][c]);
    if (iso && iso <= today) cols.push({ c: c, iso: iso });
  }
  for (var i = 1; i < v.length; i++) {
    if (!/^\d+$/.test(String(v[i][0]).trim())) continue;
    var id = sid_(v[i][1]); if (!id) continue;
    students.push({ row: i + 1, idx: i, no: Number(v[i][0]), id: id, name: str_(v[i][2]) });
  }
  return { sh: sh, v: v, grade: 'ม.' + mm[1], room: String(Number(mm[2])), cols: cols, students: students };
}
function codeOf_(cell) { var k = String(cell || '').trim().charAt(0); return ATT_CODES[k] ? k : ''; }
function pickDate_(cols, date) {
  var dates = cols.map(function (c) { return c.iso; });
  if (!dates.length) throw err_('INPUT', 'ห้องนี้ยังไม่มีวันเรียนที่บันทึกได้');
  var d = normDate_(str_(date));
  return dates.indexOf(d) >= 0 ? d : dates[dates.length - 1];
}

/* ---------- EditLog ---------- */
function editLog_(u, base, list) {
  if (!list.length) return;
  var at = now_();
  append_('EditLog', list.map(function (x) {
    return Object.assign({ at: at, by: by_(u), year: year_(), term: term_() }, base, x);
  }));
}
function recLog_(p) {
  var q = String(p.q || '').trim().toLowerCase(), kind = String(p.kind || '');
  var list = rows_('EditLog').filter(function (r) {
    if (kind && r.kind !== kind) return false;
    if (q && [r.by, r.room, r.student_id, r.student_name, r.reason, r.date].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).map(function (r) { delete r._row; return r; });
  list.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
  return { total: list.length, rows: list.slice(0, Math.min(Number(p.limit) || 500, 3000)) };
}

/* ===================== การมาเรียน ===================== */
function recAttGet_(p) {
  var o = recSource_(), cls = recClasses_().indexOf(String(p.cls || '')) >= 0 ? String(p.cls) : recClasses_()[0];
  var R = recRoom_(o.ss, cls), date = pickDate_(R.cols, p.date);
  var col = R.cols.filter(function (c) { return c.iso === date; })[0].c;
  var ids = {}; R.students.forEach(function (s) { ids[s.id] = 1; });
  var scoreOf = {};
  rows_('BehaviorLog').forEach(function (b) {
    if (b.date === date && ids[b.student_id] && b.status !== 'void' && b.item_id !== 'OPEN') (scoreOf[b.student_id] = scoreOf[b.student_id] || []).push(b.item_name + ' (' + b.points + ')');
  });
  return {
    year: year_(), term: term_(), cls: cls, date: date, today: today_(), classes: recClasses_(),
    dates: R.cols.map(function (c) { return c.iso; }).reverse(),
    students: R.students.map(function (s) { return { no: s.no, id: s.id, name: s.name, code: codeOf_(R.v[s.idx][col]), scores: scoreOf[s.id] || [] }; })
  };
}

function recAttSave_(u, p) {
  var reason = String(p.reason || '').trim(), ch = p.changes || [];
  if (!reason) throw err_('INPUT', 'กรุณาระบุเหตุผลการแก้ไข');
  if (!ch.length) throw err_('INPUT', 'ยังไม่มีรายการที่แก้ไข');
  var o = recSource_(), cls = String(p.cls), date = normDate_(str_(p.date)), batch = newBatch_();
  return lock_(function () {
    var R = recRoom_(o.ss, cls), col = R.cols.filter(function (c) { return c.iso === date; })[0];
    if (!col) throw err_('INPUT', 'วันที่ ' + date + ' ไม่อยู่ในภาคเรียนปัจจุบันหรือยังไม่ถึง');
    var byId = {}; R.students.forEach(function (s) { byId[s.id] = s; });
    var conflicts = [], todo = [];
    ch.forEach(function (c) {
      var s = byId[sid_(c.id)], nw = String(c.code || '');
      if (!s) throw err_('INPUT', 'ไม่พบนักเรียน ' + c.id + ' ในห้อง ' + cls);
      if (!ATT_LABEL[nw]) throw err_('INPUT', 'สถานะไม่ถูกต้อง');
      var cur = codeOf_(R.v[s.idx][col.c]);
      if (cur !== String(c.old || '')) conflicts.push(s.name);
      else if (cur !== nw) todo.push({ s: s, old: cur, nw: nw });
    });
    if (conflicts.length) throw err_('CONFLICT', 'ข้อมูลถูกแก้ไขโดยผู้อื่นระหว่างนี้ (' + conflicts.join(', ') + ') กรุณาโหลดใหม่แล้วแก้อีกครั้ง');
    if (!todo.length) return { changed: 0 };
    todo.forEach(function (t) {
      R.sh.getRange(t.s.row, col.c + 1).setValue(ATT_LABEL[t.nw]);
      R.v[t.s.idx][col.c] = ATT_LABEL[t.nw];
    });
    SpreadsheetApp.flush();
    editLog_(u, { kind: 'การมาเรียน', date: date, room: cls, reason: reason, batch_id: batch }, todo.map(function (t) {
      return { student_id: t.s.id, student_name: t.s.name, field: 'สถานะ', old_value: t.old ? ATT_CODES[t.old] : 'ว่าง', new_value: ATT_CODES[t.nw] };
    }));
    refreshRoom_(o.src, R);
    audit_(by_(u), 'recAttSave', { cls: cls, date: date, n: todo.length, batch: batch });
    return { changed: todo.length, batch: batch };
  });
}

/** คำนวณสถิติของห้องใหม่จากค่าในชีต → AttendanceStats / AttendanceRoomDaily / AttendanceDaily (เฉพาะห้องนี้) */
function refreshRoom_(src, R) {
  var key = { '1': 'present', '2': 'official', '3': 'leave', '4': 'late', '5': 'absent' }, stamp = now_();
  var ids = {}, stats = [], daily = [], roomDaily = [], dayCnt = {};
  R.cols.forEach(function (col) { dayCnt[col.iso] = { present: 0, official: 0, leave: 0, late: 0, absent: 0, coded: 0 }; });
  R.students.forEach(function (s) {
    ids[s.id] = 1;
    var x = { present: 0, official: 0, leave: 0, late: 0, absent: 0 };
    R.cols.forEach(function (col) {
      var code = codeOf_(R.v[s.idx][col.c]); if (!code) return;
      x[key[code]]++; dayCnt[col.iso][key[code]]++; dayCnt[col.iso].coded++;
      if (code !== '1') daily.push({ date: col.iso, student_id: s.id, grade: R.grade, room: R.room, status: ATT_CODES[code], dress_items: '' });
    });
    stats.push({ year: src.year, term: src.term, student_id: s.id, present: x.present, official: x.official, leave: x.leave, late: x.late, absent: x.absent,
                 days: x.present + x.official + x.leave + x.late + x.absent, dress: 0, updated_at: stamp });
  });
  Object.keys(dayCnt).forEach(function (iso) {
    var dc = dayCnt[iso]; if (!dc.coded) return;
    roomDaily.push({ year: src.year, term: src.term, date: iso, grade: R.grade, room: R.room, total: R.students.length, present: dc.present, official: dc.official,
                     leave: dc.leave, late: dc.late, absent: dc.absent, blank: Math.max(0, R.students.length - dc.coded) });
  });
  // คงจำนวนผิดระเบียบแต่งกายเดิม และรายการแต่งกายรายวัน
  var dressCnt = {}, dressDay = {};
  rows_('DressChecks').forEach(function (d) {
    if (d.year !== src.year || d.term !== src.term || !ids[d.student_id]) return;
    dressCnt[d.student_id] = (dressCnt[d.student_id] || 0) + 1;
    dressDay[d.date + '|' + d.student_id] = d.items;
  });
  stats.forEach(function (s) { s.dress = dressCnt[s.student_id] || 0; });
  var seen = {};
  daily.forEach(function (d) { var k = d.date + '|' + d.student_id; seen[k] = 1; if (dressDay[k] !== undefined) d.dress_items = dressDay[k]; });
  Object.keys(dressDay).forEach(function (k) {
    if (seen[k]) return;
    var pr = k.split('|'); daily.push({ date: pr[0], student_id: pr[1], grade: R.grade, room: R.room, status: 'มา', dress_items: dressDay[k] });
  });
  var sameTerm = function (r) { return r.year === src.year && r.term === src.term; };
  writeAll_('AttendanceStats', rows_('AttendanceStats').filter(function (r) { return !(sameTerm(r) && ids[r.student_id]); }).concat(stats));
  writeAll_('AttendanceRoomDaily', rows_('AttendanceRoomDaily').filter(function (r) { return !(sameTerm(r) && r.grade === R.grade && r.room === R.room); }).concat(roomDaily)
    .sort(function (a, b) { return b.date.localeCompare(a.date) || gnum_(a.grade) - gnum_(b.grade) || Number(a.room) - Number(b.room); }));
  var termDates = {}; R.cols.forEach(function (c) { termDates[c.iso] = 1; });
  writeAll_('AttendanceDaily', rows_('AttendanceDaily').filter(function (r) { return !(ids[r.student_id] && termDates[r.date]); }).concat(daily)
    .sort(function (a, b) { return b.date.localeCompare(a.date); }));
  // ห้องที่เช็กชื่อวันนี้
  try {
    var att = JSON.parse(cfg_('ATT_TODAY') || '{}'), today = today_(), c = cls_(R.grade, R.room);
    if (att.date === today && dayCnt[today] && dayCnt[today].coded && (att.rooms || []).indexOf(c) < 0) { att.rooms.push(c); setCfg_('ATT_TODAY', JSON.stringify(att)); }
  } catch (e) {}
  bumpSummary_();
}

/* ===================== การแต่งกาย ===================== */
function dressSheet_(ss) {
  var sh = ss.getSheetByName('_ตรวจระเบียบ');
  if (!sh) throw err_('NOTFOUND', 'ไม่พบชีต _ตรวจระเบียบ ในไฟล์ E-Attendance');
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var ix = {}; ['date', 'student_id', 'room', 'items', 'note', 'recorded_by', 'recorded_at', 'status'].forEach(function (k) { ix[k] = h.indexOf(k); });
  if (ix.date < 0 || ix.student_id < 0 || ix.items < 0) throw err_('SERVER', 'หัวคอลัมน์ชีต _ตรวจระเบียบ ไม่ครบ');
  return { sh: sh, v: v, h: h, ix: ix };
}
function dressActive_(D, date) {   // { id: {row, items[], note} } — แถวล่าสุดที่ไม่ใช่ void
  var out = {};
  for (var i = 1; i < D.v.length; i++) {
    var r = D.v[i];
    if (D.ix.status >= 0 && str_(r[D.ix.status]).toLowerCase() === 'void') continue;
    if (cellDate_(r[D.ix.date]) !== date) continue;
    var id = sid_(r[D.ix.student_id]); if (!id) continue;
    out[id] = { row: i + 1, items: splitList_(r[D.ix.items]), note: D.ix.note >= 0 ? str_(r[D.ix.note]) : '' };
  }
  return out;
}
function dressItemList_(ss) {
  var sh = ss.getSheetByName('_รายการตรวจระเบียบ');
  if (!sh || sh.getLastRow() < 2) return ['เครื่องแบบ', 'รองเท้า/ถุงเท้า', 'เข็มขัด/ป้ายชื่อ', 'เครื่องประดับ', 'เล็บ/แต่งหน้า', 'อื่น ๆ'];
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var ii = h.indexOf('item'), ia = h.indexOf('active'), is = h.indexOf('sort');
  return v.slice(1).filter(function (r) { return str_(r[ii]) && (ia < 0 || bool_(r[ia]) || str_(r[ia]) === ''); })
    .sort(function (a, b) { return num_(a[is], 99) - num_(b[is], 99); }).map(function (r) { return str_(r[ii]); });
}

function recDressGet_(p) {
  var o = recSource_(), cls = recClasses_().indexOf(String(p.cls || '')) >= 0 ? String(p.cls) : recClasses_()[0];
  var R = recRoom_(o.ss, cls), date = pickDate_(R.cols, p.date);
  var col = R.cols.filter(function (c) { return c.iso === date; })[0].c, act = dressActive_(dressSheet_(o.ss), date);
  return {
    year: year_(), term: term_(), cls: cls, date: date, today: today_(), classes: recClasses_(), items: dressItemList_(o.ss),
    dates: R.cols.map(function (c) { return c.iso; }).reverse(),
    students: R.students.map(function (s) {
      var a = act[s.id];
      return { no: s.no, id: s.id, name: s.name, code: codeOf_(R.v[s.idx][col]), has: !!a, items: a ? a.items : [], note: a ? a.note : '' };
    })
  };
}

function recDressSave_(u, p) {
  var reason = String(p.reason || '').trim(), ch = p.changes || [];
  if (!reason) throw err_('INPUT', 'กรุณาระบุเหตุผลการแก้ไข');
  if (!ch.length) throw err_('INPUT', 'ยังไม่มีรายการที่แก้ไข');
  var o = recSource_(), cls = String(p.cls), date = normDate_(str_(p.date)), batch = newBatch_();
  return lock_(function () {
    var R = recRoom_(o.ss, cls);
    if (!R.cols.some(function (c) { return c.iso === date; })) throw err_('INPUT', 'วันที่ ' + date + ' ไม่อยู่ในภาคเรียนปัจจุบันหรือยังไม่ถึง');
    var byId = {}; R.students.forEach(function (s) { byId[s.id] = s; });
    var D = dressSheet_(o.ss), act = dressActive_(D, date), conflicts = [], logs = [], appends = [], n = 0;
    var same = function (a, b) { return a.slice().sort().join('|') === b.slice().sort().join('|'); };
    ch.forEach(function (c) {
      var id = sid_(c.id), s = byId[id];
      if (!s) throw err_('INPUT', 'ไม่พบนักเรียน ' + c.id + ' ในห้อง ' + cls);
      var a = act[id], oldItems = a ? a.items : [], oldNote = a ? a.note : '';
      if (!same(oldItems, c.oldItems || []) || oldNote !== String(c.oldNote || '')) { conflicts.push(s.name); return; }
      var items = (c.items || []).map(String).filter(Boolean), note = String(c.note || '').trim(), voidIt = !!c.void || (!items.length && !!a);
      var log = function (field, o2, n2) { logs.push({ student_id: id, student_name: s.name, field: field, old_value: o2, new_value: n2 }); };
      if (voidIt) {
        if (!a) return;
        if (D.ix.status < 0) throw err_('SERVER', 'ชีต _ตรวจระเบียบ ไม่มีคอลัมน์ status');
        D.sh.getRange(a.row, D.ix.status + 1).setValue('void');
        log('ยกเลิกบันทึก', oldItems.join(', ') + (oldNote ? ' (' + oldNote + ')' : ''), 'void'); n++;
      } else if (a) {
        if (!same(items, oldItems)) { D.sh.getRange(a.row, D.ix.items + 1).setValue(items.join(', ')); log('รายการ', oldItems.join(', '), items.join(', ')); }
        if (note !== oldNote && D.ix.note >= 0) { D.sh.getRange(a.row, D.ix.note + 1).setValue(note); log('หมายเหตุ', oldNote, note); }
        if (!same(items, oldItems) || note !== oldNote) n++;
      } else if (items.length) {
        var row = D.h.map(function () { return ''; });
        row[D.ix.date] = date; row[D.ix.student_id] = id;
        if (D.ix.room >= 0) row[D.ix.room] = cls;
        row[D.ix.items] = items.join(', ');
        if (D.ix.note >= 0) row[D.ix.note] = note;
        if (D.ix.recorded_by >= 0) row[D.ix.recorded_by] = u.id;
        if (D.ix.recorded_at >= 0) row[D.ix.recorded_at] = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
        if (D.ix.status >= 0) row[D.ix.status] = 'active';
        appends.push(row);
        log('เพิ่มบันทึก', 'ไม่มีบันทึก', items.join(', ') + (note ? ' (' + note + ')' : '')); n++;
      }
    });
    if (conflicts.length) throw err_('CONFLICT', 'ข้อมูลถูกแก้ไขโดยผู้อื่นระหว่างนี้ (' + conflicts.join(', ') + ') กรุณาโหลดใหม่แล้วแก้อีกครั้ง');
    if (appends.length) {
      var start = D.sh.getLastRow() + 1, rng = D.sh.getRange(start, 1, appends.length, D.h.length);
      rng.setNumberFormat('@'); rng.setValues(appends);
    }
    SpreadsheetApp.flush();
    editLog_(u, { kind: 'การแต่งกาย', date: date, room: cls, reason: reason, batch_id: batch }, logs);
    refreshDress_(o.src, o.ss, R);
    audit_(by_(u), 'recDressSave', { cls: cls, date: date, n: n, batch: batch });
    return { changed: n, batch: batch };
  });
}

/** สร้าง DressChecks ของภาคเรียนนี้ใหม่จากชีต แล้วอัปเดตจำนวนครั้ง/รายการรายวันของห้องที่แก้ */
function refreshDress_(src, ss, R) {
  var D = dressSheet_(ss), today = today_(), per = {}, seen = {}, dress = [];
  var stuRoom = {}; activeStudents_().forEach(function (s) { stuRoom[s.student_id] = s; });
  for (var k = 1; k < D.v.length; k++) {
    var r = D.v[k];
    if (D.ix.status >= 0 && str_(r[D.ix.status]).toLowerCase() === 'void') continue;
    var dd = cellDate_(r[D.ix.date]), id = sid_(r[D.ix.student_id]), st = stuRoom[id];
    if (!id || !dd || dd > today || !st) continue;
    var rec = { year: src.year, term: src.term, date: dd, student_id: id, grade: st.grade, room: st.room, items: str_(r[D.ix.items]),
                note: D.ix.note >= 0 ? str_(r[D.ix.note]) : '', recorded_by: D.ix.recorded_by >= 0 ? str_(r[D.ix.recorded_by]) : '' };
    var sk = dd + '|' + id;
    if (seen[sk] !== undefined) { dress[seen[sk]] = rec; continue; }
    seen[sk] = dress.length; dress.push(rec); per[id] = (per[id] || 0) + 1;
  }
  var sameTerm = function (r) { return r.year === src.year && r.term === src.term; };
  writeAll_('DressChecks', rows_('DressChecks').filter(function (r) { return !sameTerm(r); }).concat(dress).sort(function (a, b) { return b.date.localeCompare(a.date); }));
  var upd = rows_('AttendanceStats').filter(function (s) { return sameTerm(s) && num_(s.dress) !== (per[s.student_id] || 0); })
    .map(function (s) { return Object.assign({}, s, { dress: per[s.student_id] || 0 }); });
  updateRows_('AttendanceStats', upd);
  refreshRoom_(src, R);   // รายการแต่งกายรายวันของห้องนี้ + bumpSummary
}

/* ===================== ทรงผม ===================== */
function hairRounds_(ss) {
  var sh = ss.getSheetByName('_รอบตรวจทรงผม');
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var g = function (r, k) { var i = h.indexOf(k); return i >= 0 ? r[i] : ''; };
  return v.slice(1).filter(function (r) { return str_(g(r, 'round_id')); }).map(function (r) {
    return { round_id: str_(g(r, 'round_id')), title: str_(g(r, 'title')), status: str_(g(r, 'status')),
             dates: splitList_(g(r, 'dates')).map(function (d) { return normDate_(d) || d; }).sort() };
  });
}
function hairSheet_(ss) {
  var sh = ss.getSheetByName('_ตรวจทรงผม');
  if (!sh) throw err_('NOTFOUND', 'ไม่พบชีต _ตรวจทรงผม ในไฟล์ E-Attendance');
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var ix = {}; ['round_id', 'date', 'student_id', 'room', 'result', 'note', 'source', 'recorded_by', 'recorded_at'].forEach(function (k) { ix[k] = h.indexOf(k); });
  if (ix.round_id < 0 || ix.date < 0 || ix.student_id < 0 || ix.result < 0) throw err_('SERVER', 'หัวคอลัมน์ชีต _ตรวจทรงผม ไม่ครบ');
  return { sh: sh, v: v, h: h, ix: ix };
}
function hairMap_(H, roundId) {   // { 'date|id': {row, result, note, source} } — แถวล่าสุดชนะ
  var out = {};
  for (var i = 1; i < H.v.length; i++) {
    var r = H.v[i];
    if (str_(r[H.ix.round_id]) !== roundId) continue;
    var id = sid_(r[H.ix.student_id]), d = cellDate_(r[H.ix.date]);
    if (!id || !d) continue;
    out[d + '|' + id] = { row: i + 1, result: str_(r[H.ix.result]), note: H.ix.note >= 0 ? str_(r[H.ix.note]) : '', source: H.ix.source >= 0 ? str_(r[H.ix.source]) : '' };
  }
  return out;
}

function recHairGet_(p) {
  var o = recSource_(), rounds = hairRounds_(o.ss), today = today_();
  if (!rounds.length) return { rounds: [], classes: recClasses_(), today: today };
  var rd = rounds.filter(function (r) { return r.round_id === String(p.round_id || ''); })[0];
  if (!rd) {   // ค่าเริ่มต้น: รอบล่าสุดที่เริ่มแล้ว
    var started = rounds.filter(function (r) { return r.dates.length && r.dates[0] <= today; });
    rd = started.length ? started.sort(function (a, b) { return a.dates[0] < b.dates[0] ? 1 : -1; })[0] : rounds[0];
  }
  var cls = recClasses_().indexOf(String(p.cls || '')) >= 0 ? String(p.cls) : recClasses_()[0], R = recRoom_(o.ss, cls);
  var editable = rd.dates.filter(function (d) { return d <= today; });
  var date = editable.indexOf(normDate_(str_(p.date))) >= 0 ? normDate_(str_(p.date)) : (editable[editable.length - 1] || '');
  var M = hairMap_(hairSheet_(o.ss), rd.round_id), di = rd.dates.indexOf(date), next = di >= 0 ? rd.dates[di + 1] || '' : '';
  var col = R.cols.filter(function (c) { return c.iso === date; })[0];
  return {
    year: year_(), term: term_(), today: today, classes: recClasses_(), cls: cls,
    rounds: rounds.map(function (r) { return { round_id: r.round_id, title: r.title, status: r.status, dates: r.dates }; }),
    round_id: rd.round_id, dates: rd.dates, date: date, next: next, nextEditable: !!next && next <= today,
    students: R.students.map(function (s) {
      var t = date ? M[date + '|' + s.id] : null, nx = next ? M[next + '|' + s.id] : null;
      return { no: s.no, id: s.id, name: s.name, code: col ? codeOf_(R.v[s.idx][col.c]) : '',
               result: t ? t.result : '', note: t ? t.note : '', source: t ? t.source : '', nextResult: nx ? nx.result : '' };
    })
  };
}

function recHairSave_(u, p) {
  var reason = String(p.reason || '').trim(), ch = p.changes || [];
  if (!reason) throw err_('INPUT', 'กรุณาระบุเหตุผลการแก้ไข');
  if (!ch.length) throw err_('INPUT', 'ยังไม่มีรายการที่แก้ไข');
  var o = recSource_(), cls = String(p.cls), date = normDate_(str_(p.date)), today = today_(), batch = newBatch_();
  return lock_(function () {
    var rd = hairRounds_(o.ss).filter(function (r) { return r.round_id === String(p.round_id); })[0];
    if (!rd) throw err_('NOTFOUND', 'ไม่พบรอบตรวจ ' + p.round_id);
    var di = rd.dates.indexOf(date);
    if (di < 0 || date > today) throw err_('INPUT', 'วันที่นี้ไม่ใช่วันตรวจของรอบ หรือยังไม่ถึง');
    var R = recRoom_(o.ss, cls), byId = {}; R.students.forEach(function (s) { byId[s.id] = s; });
    var H = hairSheet_(o.ss), M = hairMap_(H, rd.round_id), conflicts = [], logs = [], appends = [], n = 0, copies = 0;
    var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    var newRow = function (d, id, result, note, source) {
      var row = H.h.map(function () { return ''; });
      row[H.ix.round_id] = rd.round_id; row[H.ix.date] = d; row[H.ix.student_id] = id; row[H.ix.result] = result;
      if (H.ix.room >= 0) row[H.ix.room] = cls;
      if (H.ix.note >= 0) row[H.ix.note] = note;
      if (H.ix.source >= 0) row[H.ix.source] = source;
      if (H.ix.recorded_by >= 0) row[H.ix.recorded_by] = u.id;
      if (H.ix.recorded_at >= 0) row[H.ix.recorded_at] = stamp;
      return row;
    };
    ch.forEach(function (c) {
      var id = sid_(c.id), s = byId[id], result = String(c.result || ''), note = String(c.note || '').trim();
      if (!s) throw err_('INPUT', 'ไม่พบนักเรียน ' + c.id + ' ในห้อง ' + cls);
      if (HAIR_RESULTS.indexOf(result) < 0) throw err_('INPUT', 'ผลตรวจไม่ถูกต้อง');
      if (result === 'ไม่ผ่าน' && !note) throw err_('INPUT', 'กรุณาระบุหมายเหตุของ ' + s.name + ' (ไม่ผ่าน)');
      var cur = M[date + '|' + id];
      if ((cur ? cur.result : '') !== String(c.oldResult || '') || (cur ? cur.note : '') !== String(c.oldNote || '')) { conflicts.push(s.name); return; }
      if (cur && cur.result === result && cur.note === note) return;
      var log = function (d, field, o2, n2) { logs.push({ date: d, student_id: id, student_name: s.name, field: field, old_value: o2, new_value: n2 }); };
      if (cur) {
        H.sh.getRange(cur.row, H.ix.result + 1).setValue(result);
        if (H.ix.note >= 0) H.sh.getRange(cur.row, H.ix.note + 1).setValue(note);
        if (H.ix.source >= 0) H.sh.getRange(cur.row, H.ix.source + 1).setValue('แก้ไขโดยแอดมิน');
      } else appends.push(newRow(date, id, result, note, 'แก้ไขโดยแอดมิน'));
      log(date, 'ผลตรวจ', cur ? cur.result + (cur.note ? ' (' + cur.note + ')' : '') : 'ว่าง', result + (note ? ' (' + note + ')' : ''));
      n++;
      // ผ่าน → คัดลอกไปวันตรวจถัดไปที่ยังว่าง (ต่อเนื่อง ไม่เกินวันนี้) · เจอวันที่มีผลแล้วหยุด
      if (result === 'ผ่าน') {
        for (var j = di + 1; j < rd.dates.length && rd.dates[j] <= today; j++) {
          if (M[rd.dates[j] + '|' + id]) break;
          appends.push(newRow(rd.dates[j], id, 'ผ่าน', '', 'คัดลอก'));
          log(rd.dates[j], 'ผลตรวจ (คัดลอกอัตโนมัติ)', 'ว่าง', 'ผ่าน'); copies++;
        }
      }
    });
    if (conflicts.length) throw err_('CONFLICT', 'ข้อมูลถูกแก้ไขโดยผู้อื่นระหว่างนี้ (' + conflicts.join(', ') + ') กรุณาโหลดใหม่แล้วแก้อีกครั้ง');
    if (appends.length) {
      var start = H.sh.getLastRow() + 1, rng = H.sh.getRange(start, 1, appends.length, H.h.length);
      rng.setNumberFormat('@'); rng.setValues(appends);
    }
    SpreadsheetApp.flush();
    editLog_(u, { kind: 'ทรงผม', room: cls, reason: reason + ' · รอบ ' + rd.round_id, batch_id: batch }, logs);
    audit_(by_(u), 'recHairSave', { cls: cls, date: date, round: rd.round_id, n: n, copies: copies, batch: batch });
    return { changed: n, copies: copies, batch: batch };
  });
}
