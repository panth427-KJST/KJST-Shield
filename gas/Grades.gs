/********************************************************************
 * Grades.gs — ผลการเรียนจาก KJST e-Score (อ่านอย่างเดียว)
 *  - อ่าน ReportMeta / ReportSnap / SgsSnap_M1..6 จากไฟล์ e-Score เฉพาะระดับชั้นที่ "เผยแพร่แล้ว"
 *  - เขียนสำเนาลงชีต GradeTerm (ไฟล์ database ของ Shield) 1 แถว/นักเรียน/ภาคเรียน
 *  - จัดกลุ่มสาระด้วย "รหัสวิชา" (อักษรตัวแรก) ตาม Config GRADE_GROUPS
 *  - ค่าเฉลี่ยกลุ่ม = Σ(เกรด×หน่วยกิต)/Σหน่วยกิต ของทุกรายวิชาในกลุ่ม (พื้นฐาน+เพิ่มเติม) ที่ตัดสินผลแล้ว (0–4)
 *      เกรด 0 นำมาคิด + ธง '0' · ร/มส ไม่นำมาคิด + ธง 'ร'/'มส'
 *      วิชาที่แก้ตัวแล้ว (st = 'แก้ 0 แล้ว'/'แก้ ร แล้ว') ใช้เกรดแก้ตัว ไม่ติดธง และเก็บหมายเหตุใน fx
 *  - ซิงก์: แอดมินกดเอง หรืออัตโนมัติเมื่อวันเผยแพร่ใน ReportMeta ใหม่กว่ารอบที่ซิงก์ไว้ (ตรวจเมื่อเปิดเมนู · แคช 30 นาที)
 ********************************************************************/

var GRADE_FLAGS = ['0', 'ร', 'มส'];
/** ตัดทศนิยม 2 ตำแหน่ง (แบบเดียวกับ GPA ใน e-Score / ปพ.) */
function trunc2_(x) { return Math.floor(x * 100 + 1e-9) / 100; }

/* ---------- การอ่านไฟล์ e-Score ---------- */
function escoreBook_() {
  if (!BOOKS_._escore) {
    try { BOOKS_._escore = SpreadsheetApp.openById(fileId_('ESCORE')); }
    catch (e) { throw err_('SERVER', 'เปิดไฟล์ KJST e-Score ไม่ได้ (' + e.message + ') ตรวจสอบสิทธิ์ของบัญชีเจ้าของสคริปต์'); }
  }
  return BOOKS_._escore;
}
function escoreValues_(name, cols) {
  var s = escoreBook_().getSheetByName(name);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(1, 1, s.getLastRow(), cols || s.getLastColumn()).getValues();
}
function escoreObjs_(name) {
  var v = escoreValues_(name);
  if (!v.length) return [];
  var h = v[0].map(function (x) { return String(x).trim(); }), out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {}; for (var j = 0; j < h.length; j++) if (h[j]) o[h[j]] = v[i][j];
    out.push(o);
  }
  return out;
}

/** ReportMeta: [{code:'M1', grade:'ม.1', term:'1/2569', status, pubIso, pubAt, subj:{code:{nm,sh,cr,ty}}}] */
function escoreMeta_(withSubj) {
  return escoreObjs_('ReportMeta').filter(function (m) { return str_(m.grade) && str_(m.term); }).map(function (m) {
    var o = { code: str_(m.grade), grade: normGrade_(m.grade), term: str_(m.term), status: str_(m.status), pubIso: str_(m.pubIso), pubAt: str_(m.pubAt) };
    if (withSubj) {
      var ps = {}; try { ps = JSON.parse(String(m.pubStats || '{}')) || {}; } catch (e) {}
      o.subj = ps.subj || {}; o.acts = (ps.acts || []).map(function (a) { return str_(a.s || a.n).replace(/^ก\./, 'กิจกรรม'); });
    }
    return o;
  });
}

/** ตรวจวันเผยแพร่แบบเบา (แคช 30 นาที) */
function escoreMetaCached_() {
  var c = cache_().get('GRD_META');
  if (c) return JSON.parse(c);
  var m = escoreMeta_(false).filter(function (x) { return x.status === 'published'; });
  cache_().put('GRD_META', JSON.stringify(m), 1800);
  return m;
}

/* ---------- กลุ่มสาระ ---------- */
function gradeGroups_() {
  if (MEMO_._ggrp) return MEMO_._ggrp;
  var map = {}, order = [];
  splitList_(cfg_('GRADE_GROUPS')).forEach(function (p) {
    var a = p.split(':'); if (a.length < 2) return;
    var k = a[0].trim(), g = a.slice(1).join(':').trim();
    if (!k || !g) return;
    map[k] = g; if (order.indexOf(g) < 0) order.push(g);
  });
  MEMO_._ggrp = { map: map, order: order };
  return MEMO_._ggrp;
}
function groupOf_(code) {
  var G = gradeGroups_(), c = String(code || '').trim();
  if (G.map[c.slice(0, 2)]) return G.map[c.slice(0, 2)];   // รองรับรหัสนำหน้า 2 ตัวอักษร (เช่น IS)
  return G.map[c.charAt(0)] || 'อื่น ๆ';
}

/** ค่าเฉลี่ยรายกลุ่มจากรายวิชาของนักเรียน 1 คน */
function groupAvgs_(subs) {
  var acc = {};
  subs.forEach(function (s) {
    var a = acc[s.grp] = acc[s.grp] || { gp: 0, cr: 0, f: {} };
    if (s.st) { a.f[s.st] = 1; return; }
    if (typeof s.g !== 'number') return;
    a.gp += s.g * s.cr; a.cr += s.cr;
    if (s.g === 0) a.f['0'] = 1;
  });
  var out = {};
  Object.keys(acc).forEach(function (k) {
    var a = acc[k];
    out[k] = { avg: a.cr ? trunc2_(a.gp / a.cr) : null, cr: a.cr, f: GRADE_FLAGS.filter(function (x) { return a.f[x]; }) };
  });
  return out;
}

/* ---------- ซิงก์ ---------- */
function termKey_(t) { var m = String(t).match(/^(\d)\/(\d{4})$/); return m ? Number(m[2]) * 10 + Number(m[1]) : 0; }
function gradeSyncState_() { try { return JSON.parse(cfg_('GRADE_SYNC') || '{}'); } catch (e) { return {}; } }
function gradeVer_() { return props_().getProperty('GRD_VER') || '1'; }
function bumpGrades_() { props_().setProperty('GRD_VER', String(Number(gradeVer_()) + 1)); delete MEMO_._grd; }
function cleanTeacher_(t) {
  return String(t || '').split(/\s*[,\n]\s*|\s+(?=\d+\.)/).map(function (x) { return x.replace(/^\d+\.\s*/, '').trim(); })
    .filter(Boolean).join(', ');
}

/**
 * ซิงก์ผลการเรียน: p.term (ว่าง = ทุกภาคที่เผยแพร่), p.grades ['M1',...] (ว่าง = ทุกระดับ), p.onlyNew = เฉพาะที่มีการเผยแพร่ใหม่
 * คืน { synced: [{term, grade, rows}], skipped }
 */
function gradesSync_(by, p) {
  p = p || {};
  var meta = escoreMeta_(true).filter(function (m) { return m.status === 'published'; });
  var state = gradeSyncState_();
  var jobs = meta.filter(function (m) {
    if (p.term && m.term !== p.term) return false;
    if (p.grades && p.grades.length && p.grades.indexOf(m.code) < 0) return false;
    if (p.onlyNew) { var s = state[m.term + '|' + m.code]; return !s || s.pub !== m.pubIso; }
    return true;
  });
  if (!jobs.length) return { synced: [], skipped: meta.length };

  var snap = escoreValues_('ReportSnap', 4), stuMap = studentMap_(), at = now_(), done = [];
  var keep = rows_('GradeTerm').filter(function (r) {
    return !jobs.some(function (j) { return r.term === j.term && r.grade === j.grade; });
  }), add = [];

  jobs.forEach(function (j) {
    // ครูผู้สอน: SgsSnap ของระดับนั้น (รหัสวิชา|รหัสนักเรียน → ครู, สำรอง รหัสวิชา|ห้อง)
    var tByStu = {}, tByRoom = {};
    escoreValues_('SgsSnap_' + j.code, 7).slice(1).forEach(function (r) {
      var code = str_(r[0]), t = cleanTeacher_(r[5]); if (!code || !t) return;
      tByStu[code + '|' + sid_(r[6])] = t;
      var rm = normRoom_(String(r[4]).split('/')[1] || ''); if (rm) tByRoom[code + '|' + rm] = t;
    });
    var list = [];
    for (var i = 1; i < snap.length; i++) {
      if (str_(snap[i][0]) !== j.code || str_(snap[i][1]) !== j.term) continue;
      var d; try { d = JSON.parse(String(snap[i][3])); } catch (e) { continue; }
      var id = sid_(snap[i][2]), room = normRoom_(d.r);
      var subs = (d.s || []).map(function (s) {
        // st จาก e-Score: 'ร' / 'มส' = ยังไม่ตัดสิน · 'แก้ 0 แล้ว' / 'แก้ ร แล้ว' = แก้ตัวแล้ว (g = เกรดแก้ตัว จากคอลัมน์ "เกรดแก้ตัว" ในไฟล์รายวิชา)
        var info = j.subj[s.c] || {}, raw = str_(s.st), rawG = str_(s.g);
        var st = (raw === 'ร' || raw === 'มส') ? raw : ((rawG === 'ร' || rawG === 'มส') ? rawG : '');
        var g = st || rawG === '' || isNaN(Number(rawG)) ? '' : Number(rawG);
        var fx = !st && /แก้/.test(raw) ? raw.replace(/\s*แล้ว\s*$/, '').trim() : '';
        return { c: s.c, n: str_(info.nm), sh: str_(info.sh), ty: str_(info.ty), cr: num_(info.cr), t: s.t === undefined ? '' : s.t, g: g, st: st, fx: fx,
                 tm: s.tm === undefined ? '' : s.tm, grp: groupOf_(s.c), tc: tByStu[s.c + '|' + id] || tByRoom[s.c + '|' + room] || '' };
      });
      var gp = 0, cr = 0, n0 = 0, nr = 0, nms = 0, minTm = null;
      subs.forEach(function (s) {
        if (s.st === 'ร') nr++; else if (s.st === 'มส') nms++;
        else if (typeof s.g === 'number' && !isNaN(s.g)) { gp += s.g * s.cr; cr += s.cr; if (s.g === 0) n0++; }
        if (s.tm !== '' && !isNaN(Number(s.tm))) minTm = minTm === null ? Number(s.tm) : Math.min(minTm, Number(s.tm));
      });
      var act = (d.a || []).map(function (a, k) { return (j.acts[k] || ('กิจกรรม ' + (k + 1))) + ':' + str_(a); }), st0 = stuMap[id];
      list.push({
        term: j.term, grade: j.grade, student_id: id, room: room, no: str_(d.no), name: st0 ? fullName_(st0) : str_(d.n),
        gpa: d.gpa === null || d.gpa === undefined || d.gpa === '' ? '' : Number(d.gpa), gp_sum: Math.round(gp * 100) / 100, cr_sum: cr,
        cr_reg: num_(d.crReg), cr_get: num_(d.crGet), n_0: n0, n_r: nr, n_ms: nms,
        act: act.join('|'), act_fail: (d.a || []).filter(function (a) { return a === 'มผ'; }).length, min_time: minTm === null ? '' : minTm,
        groups: groupAvgs_(subs), subjects: subs, published_at: j.pubIso, synced_at: at
      });
    }
    // อันดับในห้อง / ในระดับ (GPA มาก→น้อย, คะแนนเท่ากันได้อันดับเดียวกัน)
    function rankBy(keyFn, field) {
      var groups = {};
      list.forEach(function (r) { if (r.gpa !== '') (groups[keyFn(r)] = groups[keyFn(r)] || []).push(r); });
      Object.keys(groups).forEach(function (k) {
        var g = groups[k].sort(function (a, b) { return b.gpa - a.gpa; });
        g.forEach(function (r, i) { r[field] = (i && g[i - 1].gpa === r.gpa) ? g[i - 1][field] : i + 1; r[field + '_n'] = g.length; });
      });
    }
    rankBy(function (r) { return r.room; }, 'rank_room');
    rankBy(function () { return 'all'; }, 'rank_grade');
    list.forEach(function (r) { r.groups = JSON.stringify(r.groups); r.subjects = JSON.stringify(r.subjects); add.push(r); });
    state[j.term + '|' + j.code] = { pub: j.pubIso, at: at, rows: list.length, by: by };
    done.push({ term: j.term, grade: j.grade, rows: list.length });
  });

  var all = keep.concat(add).sort(function (a, b) {
    return termKey_(a.term) - termKey_(b.term) || gnum_(a.grade) - gnum_(b.grade) || num_(a.room) - num_(b.room) || num_(a.no, 999) - num_(b.no, 999);
  });
  writeAll_('GradeTerm', all);
  setCfg_('GRADE_SYNC', JSON.stringify(state));
  cache_().remove('GRD_META');
  bumpGrades_(); bumpSummary_();
  audit_(by, 'gradesSync', done.map(function (d) { return d.term + ' ' + d.grade + ' ' + d.rows; }).join(', '));
  return { synced: done, skipped: meta.length - jobs.length };
}

/** ตรวจการเผยแพร่ใหม่ (เบา) แล้วซิงก์เฉพาะระดับที่เปลี่ยน — ไม่รอล็อกถ้ามีคนอื่นกำลังเขียน */
function gradesAutoSync_() {
  var meta; try { meta = escoreMetaCached_(); } catch (e) { return { error: e.message }; }
  var state = gradeSyncState_();
  var changed = meta.filter(function (m) { var s = state[m.term + '|' + m.code]; return !s || s.pub !== m.pubIso; });
  if (!changed.length) return null;
  var l = LockService.getScriptLock();
  if (!l.tryLock(1500)) return { busy: true };
  try { return gradesSync_('ระบบ (ตรวจพบการเผยแพร่ใหม่)', { onlyNew: true }); }
  finally { l.releaseLock(); }
}

/* ---------- อ่านข้อมูล GradeTerm (แคชตามเวอร์ชัน) ---------- */
function gradeData_() {
  if (MEMO_._grd) return MEMO_._grd;
  var key = 'GRD_' + gradeVer_(), c = cacheGetBig_(key);
  if (c) { MEMO_._grd = c; return c; }
  var out = rows_('GradeTerm').map(function (r) {
    var g = {}, s = [];
    try { g = JSON.parse(r.groups || '{}'); } catch (e) {}
    try { s = JSON.parse(r.subjects || '[]'); } catch (e) {}
    return { term: r.term, grade: r.grade, room: r.room, id: r.student_id, no: num_(r.no, 999), name: r.name, gpa: r.gpa === '' ? null : num_(r.gpa),
             gp: num_(r.gp_sum), cr: num_(r.cr_sum), crReg: num_(r.cr_reg), crGet: num_(r.cr_get), n0: num_(r.n_0), nr: num_(r.n_r), nms: num_(r.n_ms),
             rk: r.rank_room === '' ? null : num_(r.rank_room), rkN: num_(r.rank_room_n), rkG: r.rank_grade === '' ? null : num_(r.rank_grade), rkGN: num_(r.rank_grade_n),
             act: r.act ? r.act.split('|').map(function (x) { var a = x.split(':'); return { n: a[0], r: a[1] || '' }; }) : [], actFail: num_(r.act_fail), minTm: r.min_time === '' ? null : num_(r.min_time), groups: g, subs: s, pub: r.published_at };
  });
  cachePutBig_(key, out, 21600);
  MEMO_._grd = out;
  return out;
}
function gradeTerms_() {
  var t = {}; gradeData_().forEach(function (r) { t[r.term] = 1; });
  return Object.keys(t).sort(function (a, b) { return termKey_(b) - termKey_(a); });
}
/** ผลล่าสุดของนักเรียนแต่ละคน (สำหรับธงเสี่ยงในสรุปนักเรียน) */
function latestGrades_() {
  var terms = gradeTerms_(), out = {};
  if (!terms.length) return out;
  gradeData_().forEach(function (r) { if (r.term === terms[0]) out[r.id] = r; });
  return out;
}
function bad_(r) { return r.n0 + r.nr + r.nms; }

/* ---------- มุมมองตามบทบาท ---------- */
function gradeOptions_(u) {
  var sc = scope_(u), cm = classMap_(), views = [], grades = [], rooms = [];
  Object.keys(cm).forEach(function (g) {
    var whole = sc.all || sc.grades.indexOf(g) >= 0;
    if (whole) grades.push(g);
    cm[g].forEach(function (r) { if (whole || sc.rooms.indexOf(cls_(g, r)) >= 0) rooms.push({ v: cls_(g, r), own: sc.rooms.indexOf(cls_(g, r)) >= 0 }); });
  });
  if (sc.all) views.push('school');
  if (grades.length) views.push('grade');
  if (rooms.length) views.push('room');
  if (rooms.length) views.push('student');
  return { views: views, grades: grades, rooms: rooms };
}

function kpis_(rows) {
  var k = { n: rows.length, withGpa: 0, avg: null, bands: [0, 0, 0, 0, 0], bad: 0, n0: 0, nr: 0, nms: 0, lt2: 0, actFail: 0 }, sum = 0;
  rows.forEach(function (r) {
    if (r.gpa !== null) {
      k.withGpa++; sum += r.gpa;
      k.bands[r.gpa >= 3.5 ? 0 : r.gpa >= 3 ? 1 : r.gpa >= 2.5 ? 2 : r.gpa >= 2 ? 3 : 4]++;
      if (r.gpa < 2) k.lt2++;
    }
    if (bad_(r)) k.bad++;
    k.n0 += r.n0; k.nr += r.nr; k.nms += r.nms;
    if (r.actFail) k.actFail++;
  });
  if (k.withGpa) k.avg = Math.round(sum / k.withGpa * 100) / 100;
  return k;
}
function badItems_(rows, sm) {
  var out = [];
  rows.forEach(function (r) {
    r.subs.forEach(function (s) {
      var f = s.st || (s.g === 0 ? '0' : '');
      if (!f) return;
      var cur = sm[r.id];
      out.push({ id: r.id, name: cur ? cur.name : r.name, cls: cur ? cls_(cur.g, cur.r) : cls_(r.grade, r.room), no: cur ? cur.no : r.no,
                 code: s.c, subject: s.n || s.c, flag: f, teacher: s.tc || '' });
    });
  });
  return out.sort(function (a, b) { return a.cls.localeCompare(b.cls, 'th', { numeric: true }) || a.no - b.no || a.code.localeCompare(b.code, 'th'); });
}
function subjectStats_(rows) {
  var m = {};
  rows.forEach(function (r) {
    r.subs.forEach(function (s) {
      var x = m[s.c] = m[s.c] || { code: s.c, name: s.n || s.c, grp: s.grp, cr: s.cr, ty: s.ty, n: 0, sum: 0, cnt: 0, n0: 0, nr: 0, nms: 0, tc: {} };
      x.n++;
      if (s.st === 'ร') x.nr++; else if (s.st === 'มส') x.nms++;
      else if (typeof s.g === 'number') { x.sum += s.g; x.cnt++; if (s.g === 0) x.n0++; }
      if (s.tc) x.tc[s.tc] = 1;
    });
  });
  return Object.keys(m).map(function (k) {
    var x = m[k];
    return { code: x.code, name: x.name, grp: x.grp, cr: x.cr, ty: x.ty, n: x.n, mean: x.cnt ? Math.round(x.sum / x.cnt * 100) / 100 : null,
             n0: x.n0, nr: x.nr, nms: x.nms, bad: x.n0 + x.nr + x.nms, teachers: Object.keys(x.tc).join(', ') };
  });
}

/**
 * มุมมองผลการเรียน: p.term, p.view = school|grade|room, p.key = 'ม.3' | 'ม.3/5'
 * กลุ่มนักเรียน = นักเรียนปัจจุบันในขอบเขต (ตามชั้น/ห้องปัจจุบัน) กับผลของภาคเรียนที่เลือก
 */
function gradesView_(u, p) {
  var auto = p.check ? gradesAutoSync_() : null;
  var opt = gradeOptions_(u), terms = gradeTerms_(), state = gradeSyncState_();
  var base = { terms: terms, options: opt, groups: gradeGroups_().order, auto: auto, canSync: can_(u, 'grades.sync'),
               sync: Object.keys(state).map(function (k) { var a = k.split('|'); return { term: a[0], grade: normGrade_(a[1]), pub: state[k].pub, at: state[k].at, rows: state[k].rows }; })
                 .sort(function (a, b) { return termKey_(b.term) - termKey_(a.term) || gnum_(a.grade) - gnum_(b.grade); }) };
  if (!terms.length) return Object.assign(base, { empty: true });
  var term = terms.indexOf(p.term) >= 0 ? p.term : terms[0];
  var view = opt.views.indexOf(p.view) >= 0 && p.view !== 'student' ? p.view : (opt.views[0] === 'student' ? 'room' : opt.views[0]);
  if (!view) throw err_('PERM', 'บัญชีนี้ยังไม่ได้กำหนดระดับชั้นหรือห้องเรียนที่ดูแล');
  var key = String(p.key || '');
  if (view === 'grade' && opt.grades.indexOf(key) < 0) key = opt.grades[0];
  if (view === 'room' && !opt.rooms.some(function (r) { return r.v === key; })) {
    var own = opt.rooms.filter(function (r) { return r.own; })[0]; key = (own || opt.rooms[0]).v;
  }
  var sum = summary_(), sm = {};
  sum.forEach(function (s) { sm[s.id] = s; });
  var inSel = function (s) { return view === 'school' || (view === 'grade' && s.g === key) || (view === 'room' && cls_(s.g, s.r) === key); };
  var rows = gradeData_().filter(function (r) { return r.term === term && sm[r.id] && inSel(sm[r.id]); });
  var res = Object.assign(base, { term: term, view: view, key: key, kpi: kpis_(rows), pub: rows.length ? rows[0].pub : '' });

  if (view === 'school' || view === 'grade') {
    var byKey = {};
    rows.forEach(function (r) { var s = sm[r.id], k = view === 'school' ? s.g : cls_(s.g, s.r); (byKey[k] = byKey[k] || []).push(r); });
    res.parts = Object.keys(byKey).sort(function (a, b) { return a.localeCompare(b, 'th', { numeric: true }); })
      .map(function (k) { return Object.assign({ key: k }, kpis_(byKey[k])); });
    var ss = subjectStats_(rows).filter(function (x) { return x.bad; }).sort(function (a, b) { return b.bad - a.bad; });
    res.subjects = ss.slice(0, 30);
    res.bad = badItems_(rows, sm);
    if (view === 'grade') {   // ค่าเฉลี่ยกลุ่มสาระรายห้อง
      res.groupAvg = res.parts.map(function (pt) {
        var acc = {};
        byKey[pt.key].forEach(function (r) { Object.keys(r.groups).forEach(function (g) { var x = r.groups[g]; if (x.avg === null) return; var a = acc[g] = acc[g] || [0, 0]; a[0] += x.avg; a[1]++; }); });
        var o = { key: pt.key }; Object.keys(acc).forEach(function (g) { o[g] = Math.round(acc[g][0] / acc[g][1] * 100) / 100; }); return o;
      });
    }
  }
  if (view === 'room') {
    var g0 = key.split('/')[0], gradeRows = gradeData_().filter(function (r) { return r.term === term && sm[r.id] && sm[r.id].g === g0; });
    res.gradeAvg = kpis_(gradeRows).avg;
    res.advisors = advisorsOf_(g0, key.split('/')[1]);
    res.heads = headsOf_(g0);
    res.students = rows.map(function (r) {
      var s = sm[r.id];
      return { id: r.id, no: s.no, name: s.name, gpa: r.gpa, rk: r.rk, rkN: r.rkN, rkG: r.rkG, rkGN: r.rkGN, crReg: r.crReg, crGet: r.crGet,
               n0: r.n0, nr: r.nr, nms: r.nms, actFail: r.actFail, act: r.act, minTm: r.minTm, groups: r.groups, subs: r.subs,
               score: s.score, cert: s.cert, rate: s.rate, P: s.P, O: s.O, LV: s.LV, L: s.L, A: s.A, days: s.days, lv: s.lv, type: s.type,
               mNow: s.mNow, mProb: s.mProb, mContract: s.mContract };
    }).sort(function (a, b) { return a.no - b.no; });
    res.subjects = subjectStats_(rows).sort(function (a, b) { return a.code.localeCompare(b.code, 'th'); });
    res.bad = badItems_(rows, sm);
  }
  return res;
}

/** ผลการเรียนรายคนทุกภาค + GPAX (ใช้ทั้งครูและนักเรียน/ผู้ปกครอง) */
function gradeStudent_(id) {
  id = sid_(id);
  var rows = gradeData_().filter(function (r) { return r.id === id; }).sort(function (a, b) { return termKey_(b.term) - termKey_(a.term); });
  var gp = 0, cr = 0;
  rows.forEach(function (r) { gp += r.gp; cr += r.cr; });
  return {
    id: id, groups: gradeGroups_().order, gpax: cr ? trunc2_(gp / cr) : null,
    terms: rows.map(function (r) {
      return { term: r.term, grade: r.grade, room: r.room, no: r.no, gpa: r.gpa, rk: r.rk, rkN: r.rkN, rkG: r.rkG, rkGN: r.rkGN, crReg: r.crReg, crGet: r.crGet,
               n0: r.n0, nr: r.nr, nms: r.nms, act: r.act, actFail: r.actFail, minTm: r.minTm, groups: r.groups, subs: r.subs, pub: r.pub };
    })
  };
}

function gradeStudentStaff_(u, p) {
  var id = sid_(p.id), s = summary_().filter(function (x) { return x.id === id; })[0];
  if (!s || !inScope_(scope_(u), s.g, s.r)) throw err_('PERM', 'ไม่มีสิทธิ์ดูข้อมูลนักเรียนคนนี้');
  var r = gradeStudent_(id);
  r.student = { id: s.id, name: s.name, g: s.g, r: s.r, no: s.no, score: s.score, cert: s.cert, rate: s.rate, P: s.P, O: s.O, LV: s.LV, L: s.L, A: s.A, days: s.days,
                mNow: s.mNow, mProb: s.mProb, mContract: s.mContract, advisors: advisorsOf_(s.g, s.r), heads: headsOf_(s.g) };
  return r;
}
function gradeStudentSelf_(u) {
  var s = summary_().filter(function (x) { return x.id === u.id; })[0] || { id: u.id, name: u.name };
  var r = gradeStudent_(u.id);
  r.student = { id: s.id, name: s.name, g: s.g, r: s.r, no: s.no, score: s.score, cert: s.cert, rate: s.rate, P: s.P, O: s.O, LV: s.LV, L: s.L, A: s.A, days: s.days,
                mNow: s.mNow, mProb: s.mProb, mContract: s.mContract, advisors: s.g ? advisorsOf_(s.g, s.r) : [], heads: s.g ? headsOf_(s.g) : [] };
  return r;
}

/** หัวหน้าระดับของชั้น (สำหรับช่องลงนามในรายงาน) */
function headsOf_(grade) {
  return rows_('Users_Shield').filter(function (r) {
    return bool_(r.shield_active || 'TRUE') && splitList_(r.shield_role).indexOf('head') >= 0 && splitList_(r.grade_scope).indexOf(grade) >= 0;
  }).map(function (r) { return r.display_name; });
}
