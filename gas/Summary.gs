/********************************************************************
 * Summary.gs — คำนวณสรุปรายนักเรียน (คะแนน เวลาเรียน ระดับความเสี่ยง ผลรับรอง)
 *  ผลทั้งโรงเรียนเก็บใน CacheService พร้อมเลขเวอร์ชัน (SUM_VER)
 *  ทุกการบันทึก/ยกเลิกคะแนน นำเข้า หรือดึงข้อมูลเช็กชื่อ จะเพิ่มเลขเวอร์ชัน → คำนวณใหม่ครั้งถัดไป 1 ครั้ง
 ********************************************************************/

function sumVer_() { return props_().getProperty('SUM_VER') || '1'; }
function bumpSummary_() { props_().setProperty('SUM_VER', String(Number(sumVer_()) + 1)); delete MEMO_._sum; }

function summary_() {
  if (MEMO_._sum) return MEMO_._sum;
  var key = 'SUM_' + sumVer_() + '_' + year_() + '_' + today_();   // มาตรการ "กำลังดำเนินการ" ขึ้นกับวันที่
  var c = cacheGetBig_(key);
  if (c) { MEMO_._sum = c; return c; }
  var s = buildSummary_();
  cachePutBig_(key, s, 21600);
  MEMO_._sum = s;
  return s;
}

function buildSummary_() {
  var C = cfgAll_(), base = num_(C.BASE_SCORE, 100), year = year_();
  var T = { crit: num_(C.RISK_CRITICAL, 30), high: num_(C.RISK_HIGH, 50), watch: num_(C.RISK_WATCH, 60),
            attMin: num_(C.ATT_MIN, 80), attNear: num_(C.ATT_NEAR, 85), minDays: num_(C.MIN_DAYS, 5),
            absent: num_(C.ABSENT_WATCH, 3), late: num_(C.LATE_WATCH, 5), dress: num_(C.DRESS_WATCH, 3) };
  var certs = certRules_(), studs = activeStudents_(), st = {}, MS = measuresByStudent_(year, today_());
  var GR = {}; if (bool_(C.GRADE_FLAG)) { try { GR = latestGrades_(); } catch (e) { GR = {}; } }
  studs.forEach(function (s) { st[s.student_id] = { stage: stage_(s.grade), plus: 0, minus: 0, sev: {}, P: 0, O: 0, LV: 0, L: 0, A: 0, D: 0, dress: 0 }; });

  rows_('BehaviorLog').forEach(function (b) {
    var x = st[b.student_id];
    if (!x || b.status === 'void' || b.stage !== x.stage) return;   // ขึ้น ม.4 → เริ่ม 100 ใหม่
    var p = num_(b.points);
    if (p < 0) { x.minus -= p; if (bool_(b.severe)) x.sev[b.item_name] = (x.sev[b.item_name] || 0) + 1; }
    else x.plus += p;
  });
  rows_('AttendanceStats').forEach(function (a) {
    var x = st[a.student_id];
    if (!x || a.year !== year) return;
    x.P += num_(a.present); x.O += num_(a.official); x.LV += num_(a.leave); x.L += num_(a.late); x.A += num_(a.absent); x.D += num_(a.days); x.dress += num_(a.dress);
  });

  studs.sort(function (a, b) { return gnum_(a.grade) - gnum_(b.grade) || Number(a.room) - Number(b.room) || num_(a.number, 999) - num_(b.number, 999); });
  return studs.map(function (s) {
    var x = st[s.student_id], score = base - x.minus + x.plus;
    var rate = x.D ? round1_((x.P + x.O + x.L) / x.D * 100) : null;
    var lv = 0, reasons = [], advice = [];
    function flag(l, r, a) { if (l > lv) lv = l; reasons.push(r); if (a && advice.indexOf(a) < 0) advice.push(a); }
    if (score < T.crit) flag(3, 'คะแนนความประพฤติต่ำกว่า ' + T.crit + ' (' + score + ')', 'ประชุมผู้ปกครองร่วมฝ่ายปกครอง ทำสัญญาปรับพฤติกรรม ส่งต่อครูแนะแนว');
    else if (score < T.high) flag(2, 'คะแนนความประพฤติต่ำกว่า ' + T.high + ' (' + score + ')', 'เชิญผู้ปกครองพบครูที่ปรึกษา/หัวหน้าระดับ เข้าโครงการจิตอาสาเพื่อพัฒนาพฤติกรรม');
    else if (score < T.watch) flag(1, 'คะแนนความประพฤติต่ำกว่า ' + T.watch + ' (' + score + ')', 'ครูที่ปรึกษาพูดคุยรายบุคคล ติดตามพฤติกรรมรายสัปดาห์');
    if (rate !== null && x.D >= T.minDays) {
      if (rate < T.attMin) flag(2, 'มาเรียน ' + rate + '% ต่ำกว่าเกณฑ์ ' + T.attMin + '% (เสี่ยงไม่มีสิทธิ์สอบ)', 'เยี่ยมบ้าน ติดตามรายวัน ประสานผู้ปกครอง ส่งต่อครูแนะแนวหากมีปัญหาครอบครัว/เศรษฐกิจ');
      else if (rate < T.attNear) flag(1, 'มาเรียน ' + rate + '% ใกล้เกณฑ์', 'แจ้งผู้ปกครองและติดตามการมาเรียนอย่างใกล้ชิด');
    }
    if (x.A >= T.absent) flag(1, 'ขาดเรียนสะสม ' + x.A + ' วัน', 'ระบบเพื่อนช่วยเพื่อน และโทรติดตามผู้ปกครองทุกครั้งที่ขาด');
    if (x.L >= T.late) flag(1, 'มาสายสะสม ' + x.L + ' ครั้ง', 'กิจกรรม "มาเช้า ได้ดาว" ตรวจสอบปัญหาการเดินทาง');
    if (x.dress >= T.dress) flag(1, 'ผิดระเบียบการแต่งกาย ' + x.dress + ' ครั้ง', 'ตักเตือน ชี้แจงผู้ปกครอง ประสานกองทุนชุดนักเรียนหากขาดแคลน');
    var mx = MS[s.student_id] || { list: [], current: [], probation: 0, contract: 0 };
    if (mx.probation) flag(2, 'ทำทัณฑ์บนแล้ว ' + mx.probation + ' ครั้ง (ปีการศึกษานี้)', 'ครูที่ปรึกษาติดตามใกล้ชิด ประสานผู้ปกครองทุกสัปดาห์ ส่งต่อครูแนะแนว/ฝ่ายปกครอง');
    var gr = GR[s.student_id];
    if (gr) {
      var nb = gr.n0 + gr.nr + gr.nms, ac = [];
      if (gr.gpa !== null && gr.gpa < 2) ac.push('GPA ' + gr.gpa.toFixed(2));
      if (nb) ac.push('ติด 0/ร/มส ' + nb + ' วิชา');
      if (ac.length) flag(1, 'ผลการเรียนภาค ' + gr.term + ': ' + ac.join(' · '), 'ครูที่ปรึกษาประสานครูประจำวิชาเพื่อแก้ผลการเรียน แจ้งผู้ปกครอง และติดตามจนแก้ครบ');
    }
    Object.keys(x.sev).forEach(function (k) { flag(2, 'พฤติกรรมเสี่ยง: ' + k + ' (' + x.sev[k] + ' ครั้ง)', 'ส่งต่อครูแนะแนว/ฝ่ายปกครอง และหน่วยงานภายนอกตามความเหมาะสม'); });
    var cert = certOf_(score, certs);
    return {
      id: s.student_id, no: num_(s.number, 999), name: fullName_(s), g: s.grade, r: s.room, sex: s.gender, stage: x.stage, type: s.student_type || STUDENT_TYPES[0],
      score: score, plus: x.plus, minus: x.minus, P: x.P, O: x.O, LV: x.LV, L: x.L, A: x.A, days: x.D, rate: rate, dress: x.dress,
      lv: lv, reasons: reasons, advice: advice, cert: cert.label, certOk: cert.issue,
      mNow: mx.current.map(function (m) { return { name: m.name, start: m.start, end: m.end }; }), mProb: mx.probation, mContract: mx.contract,
      gpa: gr ? gr.gpa : null, gBad: gr ? gr.n0 + gr.nr + gr.nms : 0, gTerm: gr ? gr.term : ''
    };
  });
}

function scoped_(u) { var sc = scope_(u); return summary_().filter(function (s) { return inScope_(sc, s.g, s.r); }); }

/* ===== แดชบอร์ด: ภาพรวมทั้งโรงเรียน (ทุกคนเห็นเหมือนกัน · เฉพาะตัวเลขสรุป ไม่มีรายชื่อนักเรียน) ===== */
function dashboard_(u) {
  var list = summary_(), L = [0, 0, 0, 0], male = 0, female = 0, sumR = 0, nR = 0, sumS = 0, byGrade = {}, certCount = {};
  list.forEach(function (s) {
    L[s.lv]++;
    if (s.sex === 'ชาย') male++; else if (s.sex === 'หญิง') female++;
    if (s.rate !== null) { sumR += s.rate; nR++; }
    sumS += s.score;
    var g = byGrade[s.g] = byGrade[s.g] || { grade: s.g, n: 0, lv: [0, 0, 0, 0] };
    g.n++; g.lv[s.lv]++;
    certCount[s.cert] = (certCount[s.cert] || 0) + 1;
  });
  var today = today_(), sm = {};
  list.forEach(function (s) { sm[s.id] = s; });
  var att = {}; try { att = JSON.parse(cfg_('ATT_TODAY') || '{}'); } catch (e) {}
  var cm = classMap_(), rooms = [];
  Object.keys(cm).forEach(function (g) { cm[g].forEach(function (r) { rooms.push(cls_(g, r)); }); });
  var reported = att.date === today ? (att.rooms || []).filter(function (r) { return rooms.indexOf(r) >= 0; }).length : 0;
  // การมาเรียนวันนี้แยกระดับชั้น
  var tg = {};
  rows_('AttendanceRoomDaily').forEach(function (d) {
    if (d.date !== today || d.year !== year_() || d.term !== term_()) return;
    var x = tg[d.grade] = tg[d.grade] || { grade: d.grade, rooms: 0, total: 0, present: 0, official: 0, leave: 0, late: 0, absent: 0, blank: 0 };
    x.rooms++;
    ['total', 'present', 'official', 'leave', 'late', 'absent', 'blank'].forEach(function (k) { x[k] += num_(d[k]); });
  });
  var dress = dressDash_(list, sm, today);
  delete dress.today.list; delete dress.watchList;   // แดชบอร์ดรวมไม่แสดงรายชื่อ
  var meas = { now: 0, prob: 0, contract: 0, byName: {} };
  list.forEach(function (s) {
    if (s.mNow && s.mNow.length) { meas.now++; s.mNow.forEach(function (m) { meas.byName[m.name] = (meas.byName[m.name] || 0) + 1; }); }
    if (s.mProb) meas.prob++;
    if (s.mContract) meas.contract++;
  });
  return {
    year: year_(), term: term_(), today: today, total: list.length, male: male, female: female, levels: L,
    avgRate: nR ? round1_(sumR / nR) : null, avgScore: list.length ? round1_(sumS / list.length) : null,
    byGrade: Object.keys(byGrade).sort(function (a, b) { return gnum_(a) - gnum_(b); }).map(function (k) { return byGrade[k]; }),
    certs: certRules_().map(function (c) { return { label: c.label, issue: c.issue, min: c.min, max: c.max, n: certCount[c.label] || 0 }; }),
    attToday: Object.keys(tg).sort(function (a, b) { return gnum_(a) - gnum_(b); }).map(function (k) { return tg[k]; }),
    roomsTotal: rooms.length, roomsReported: reported, attUpdated: att.at || '',
    dress: dress, measures: meas, hasMyClass: myOptions_(u).length > 0,
    shield: shieldCalc_(year_(), summary_()).overall
  };
}

/* ===== ชั้นเรียนของฉัน: เฉพาะระดับชั้น/ห้องที่ดูแล · เลือกดูรายวันย้อนหลังได้ ===== */
/** ตัวเลือกชั้นเรียนตามขอบเขต: "ทั้งโรงเรียน" (ถ้าเห็นทั้งหมด) · "ม.X" (ทั้งระดับ) · "ม.X/Y" */
function myOptions_(u) {
  var sc = scope_(u), cm = classMap_(), out = [];
  if (sc.all) out.push({ v: 'all', label: 'ทั้งโรงเรียน' });
  Object.keys(cm).forEach(function (g) {
    var grade = sc.all || sc.grades.indexOf(g) >= 0;
    var rs = cm[g].filter(function (r) { return grade || sc.rooms.indexOf(cls_(g, r)) >= 0; });
    if (grade) out.push({ v: g, label: 'ทั้งระดับ ' + g });
    rs.forEach(function (r) { out.push({ v: cls_(g, r), label: cls_(g, r), own: sc.rooms.indexOf(cls_(g, r)) >= 0 }); });
  });
  return out;
}

function myClass_(u, p) {
  var opts = myOptions_(u);
  if (!opts.length) throw err_('FORBIDDEN', 'บัญชีนี้ยังไม่ได้กำหนดระดับชั้นหรือห้องเรียนที่ดูแล กรุณาติดต่อผู้ดูแลระบบ');
  var sc = scope_(u), vals = opts.map(function (o) { return o.v; });
  var sel = vals.indexOf(String(p.cls || '')) >= 0 ? String(p.cls) : null;
  if (!sel) {   // ค่าเริ่มต้น: ห้องที่เป็นครูที่ปรึกษา → ระดับที่เป็นหัวหน้า → ตัวเลือกแรก
    var own = opts.filter(function (o) { return o.own; })[0];
    sel = own ? own.v : (sc.grades.length && vals.indexOf(sc.grades[0]) >= 0 ? sc.grades[0] : vals[0]);
  }
  var inSel = function (g, r) { return sel === 'all' || sel === g || sel === cls_(g, r); };
  var y = year_(), term = term_(), today = today_();

  var list = summary_().filter(function (s) { return inSel(s.g, s.r); }), sm = {};
  list.forEach(function (s) { sm[s.id] = s; });
  var rdAll = rows_('AttendanceRoomDaily');
  var rd = rdAll.filter(function (d) { return d.year === y && d.term === term && inSel(d.grade, d.room) && d.date <= today; });
  var dset = {}; rd.forEach(function (d) { dset[d.date] = 1; });
  var dates = Object.keys(dset).sort().reverse();
  var date = normDate_(str_(p.date)) || '';
  if (!date || date > today) date = today;

  // สถิติวันที่เลือก
  var cm = classMap_(), roomsSel = [];
  Object.keys(cm).forEach(function (g) { cm[g].forEach(function (r) { if (inSel(g, r)) roomsSel.push({ grade: g, room: r }); }); });
  var dayRows = rd.filter(function (d) { return d.date === date; }), byRoom = {};
  dayRows.forEach(function (d) { byRoom[cls_(d.grade, d.room)] = d; });
  var day = { total: 0, present: 0, official: 0, leave: 0, late: 0, absent: 0, blank: 0, roomsRecorded: dayRows.length, roomsTotal: roomsSel.length };
  dayRows.forEach(function (d) { ['total', 'present', 'official', 'leave', 'late', 'absent', 'blank'].forEach(function (k) { day[k] += num_(d[k]); }); });
  var coded = day.present + day.official + day.leave + day.late + day.absent;
  day.rate = coded ? round1_((day.present + day.official + day.late) / coded * 100) : null;
  var rooms = roomsSel.map(function (x) {
    var c = cls_(x.grade, x.room), d = byRoom[c];
    if (!d) return { cls: c, recorded: false, total: list.filter(function (s) { return s.g === x.grade && s.r === x.room; }).length };
    var cd = num_(d.present) + num_(d.official) + num_(d.leave) + num_(d.late) + num_(d.absent);
    return { cls: c, recorded: true, total: num_(d.total), present: num_(d.present), official: num_(d.official), leave: num_(d.leave), late: num_(d.late),
             absent: num_(d.absent), blank: num_(d.blank), rate: cd ? round1_((num_(d.present) + num_(d.official) + num_(d.late)) / cd * 100) : null };
  });
  var dressDay = {};
  rows_('DressChecks').forEach(function (d) { if (d.date === date && sm[d.student_id]) dressDay[d.student_id] = d; });
  var absentees = rows_('AttendanceDaily').filter(function (d) { return d.date === date && sm[d.student_id] && d.status !== 'มา'; }).map(function (d) {
    return { id: d.student_id, name: sm[d.student_id].name, cls: cls_(d.grade, d.room), status: d.status };
  }).sort(function (a, b) { return a.cls.localeCompare(b.cls, 'th', { numeric: true }) || a.name.localeCompare(b.name, 'th'); });
  var dressList = Object.keys(dressDay).map(function (id) {
    var d = dressDay[id]; return { id: id, name: sm[id].name, cls: cls_(d.grade, d.room), items: d.items, note: d.note };
  }).sort(function (a, b) { return a.cls.localeCompare(b.cls, 'th', { numeric: true }); });

  // แนวโน้มอัตรามาเรียนรายวัน ตั้งแต่เปิดภาคเรียน
  var tr = {};
  rd.forEach(function (d) {
    var t = tr[d.date] = tr[d.date] || { ok: 0, coded: 0, absent: 0, late: 0 };
    var cd = num_(d.present) + num_(d.official) + num_(d.leave) + num_(d.late) + num_(d.absent);
    t.ok += num_(d.present) + num_(d.official) + num_(d.late); t.coded += cd; t.absent += num_(d.absent); t.late += num_(d.late);
  });
  var trend = Object.keys(tr).sort().map(function (k) { var t = tr[k]; return { date: k, rate: t.coded ? round1_(t.ok / t.coded * 100) : null, absent: t.absent, late: t.late }; });

  // ภาพรวมสะสม (ปีการศึกษา) ของกลุ่มที่เลือก
  var L = [0, 0, 0, 0], sumS = 0, sumR = 0, nR = 0;
  list.forEach(function (s) { L[s.lv]++; sumS += s.score; if (s.rate !== null) { sumR += s.rate; nR++; } });
  var dress = dressDash_(list, sm, date);
  return {
    year: y, term: term, today: today, date: date, dates: dates.slice(0, 200), sel: sel, options: opts,
    attUrl: String(cfg_('ATT_WEB_URL') || ''), attUpdated: (function () { try { return JSON.parse(cfg_('ATT_TODAY') || '{}').at || ''; } catch (e) { return ''; } })(),
    day: day, rooms: rooms, absentees: absentees, dressList: dressList, trend: trend, needPull: !rdAll.some(function (d) { return d.year === y && d.term === term; }),
    total: list.length, levels: L, avgScore: list.length ? round1_(sumS / list.length) : null, avgRate: nR ? round1_(sumR / nR) : null,
    dress: { termTotal: dress.termTotal, termStudents: dress.termStudents, items: dress.items, watchN: dress.watchN, watch: dress.watch, watchList: dress.watchList },
    measures: list.filter(function (s) { return (s.mNow && s.mNow.length) || s.mProb || s.mContract; })
      .map(function (s) { return { id: s.id, name: s.name, cls: cls_(s.g, s.r), now: s.mNow, prob: s.mProb, contract: s.mContract }; })
      .sort(function (a, b) { return b.now.length - a.now.length || b.prob - a.prob || a.cls.localeCompare(b.cls, 'th', { numeric: true }); }),
    alerts: list.filter(function (s) { return s.lv > 0; }).sort(function (a, b) { return b.lv - a.lv || a.score - b.score; }).slice(0, 300)
      .map(function (s) { return { id: s.id, name: s.name, cls: cls_(s.g, s.r), score: s.score, rate: s.rate, lv: s.lv, reasons: s.reasons, advice: s.advice }; })
  };
}

/* ===== การตรวจระเบียบการแต่งกาย (สำหรับแดชบอร์ด ตามขอบเขตของผู้ใช้) ===== */
function dressDash_(list, sm, today) {
  var term = term_(), y = year_(), watchN = cfgNum_('DRESS_WATCH') || 3;
  var recs = rows_('DressChecks').filter(function (d) { return d.year === y && d.term === term && sm[d.student_id]; });
  var tItems = {}, aItems = {}, rooms = {}, grades = {}, byDate = {}, termStu = {}, todayList = [], todayStu = {};
  recs.forEach(function (d) {
    var its = splitList_(d.items); if (!its.length) its = ['ไม่ระบุ'];
    byDate[d.date] = (byDate[d.date] || 0) + 1;
    termStu[d.student_id] = 1;
    grades[d.grade] = (grades[d.grade] || 0) + 1;
    its.forEach(function (i) { aItems[i] = (aItems[i] || 0) + 1; });
    if (d.date === today) {
      todayStu[d.student_id] = 1;
      var c = cls_(d.grade, d.room); rooms[c] = (rooms[c] || 0) + 1;
      its.forEach(function (i) { tItems[i] = (tItems[i] || 0) + 1; });
      todayList.push({ id: d.student_id, name: sm[d.student_id].name, cls: c, items: d.items, note: d.note });
    }
  });
  var toArr = function (o) { return Object.keys(o).map(function (k) { return { k: k, n: o[k] }; }).sort(function (a, b) { return b.n - a.n; }); };
  var dates = Object.keys(byDate).sort().slice(-15);
  var watch = list.filter(function (s) { return s.dress >= watchN; }).sort(function (a, b) { return b.dress - a.dress; });
  todayList.sort(function (a, b) { return a.cls.localeCompare(b.cls, 'th', { numeric: true }); });
  return {
    term: term, watchN: watchN, total: list.length,
    today: { students: Object.keys(todayStu).length, items: toArr(tItems), rooms: toArr(rooms), list: todayList },
    termTotal: recs.length, termStudents: Object.keys(termStu).length, checkDays: Object.keys(byDate).length,
    items: toArr(aItems), grades: Object.keys(grades).sort(function (a, b) { return gnum_(a) - gnum_(b); }).map(function (g) { return { k: g, n: grades[g] }; }),
    trend: dates.map(function (d) { return { date: d, n: byDate[d] }; }),
    watch: watch.length, watchList: watch.slice(0, 50).map(function (s) { return { id: s.id, name: s.name, cls: cls_(s.g, s.r), n: s.dress }; })
  };
}

/* ===== รายชื่อนักเรียน (แบบย่อ) ===== */
function studentsList_(u) {
  return scoped_(u).map(function (s) {
    return { id: s.id, no: s.no, name: s.name, g: s.g, r: s.r, type: s.type, score: s.score, rate: s.rate, lv: s.lv, cert: s.cert, certOk: s.certOk, A: s.A, L: s.L };
  });
}

/* ===== รายละเอียดรายคน ===== */
function studentDetail_(id, opts) {
  id = sid_(id);
  var s = summary_().filter(function (x) { return x.id === id; })[0];
  if (!s) throw err_('NOTFOUND', 'ไม่พบข้อมูลนักเรียน');
  var res = JSON.parse(JSON.stringify(s));
  res.year = year_(); res.term = term_();
  res.logs = rows_('BehaviorLog').filter(function (b) { return b.student_id === id; }).map(function (b) {
    return { log_id: b.log_id, date: b.date, year: b.year, term: b.term, item: b.item_name, category: b.category, points: num_(b.points),
             note: b.note, counted: b.stage === s.stage && b.status !== 'void', status: b.status, void_reason: opts.staff ? b.void_reason : '',
             by: opts.staff ? b.recorded_by : '' };
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  res.att = rows_('AttendanceDaily').filter(function (d) { return d.student_id === id; })
    .map(function (d) { return { date: d.date, status: d.status, dress: d.dress_items }; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 60);
  var mAll = rows_('MeasureLog').filter(function (m) { return m.student_id === id && m.status !== 'void'; }), td = today_(), mByLog = {};
  res.measureList = mAll.map(function (m) {
    var o = { date: m.date, year: m.year, term: m.term, name: m.name, start: m.start_date, end: m.end_date, probation: bool_(m.probation) };
    o.state = !o.end ? 'บันทึกแล้ว' : (td < o.start ? 'ยังไม่เริ่ม' : (td <= o.end ? 'กำลังดำเนินการ' : 'ครบกำหนดแล้ว'));
    (mByLog[m.log_id] = mByLog[m.log_id] || []).push(m.name);
    return o;
  }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  res.logs.forEach(function (l) { l.measures = (mByLog[l.log_id] || []).join(', '); });
  res.dressLog = rows_('DressChecks').filter(function (d) { return d.student_id === id; })
    .map(function (d) { return { date: d.date, year: d.year, term: d.term, items: d.items, note: d.note, by: opts.staff ? d.recorded_by : '' }; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  res.terms = rows_('AttendanceStats').filter(function (a) { return a.student_id === id; }).map(function (a) {
    return { year: a.year, term: a.term, present: num_(a.present), official: num_(a.official), leave: num_(a.leave), late: num_(a.late), absent: num_(a.absent), days: num_(a.days), dress: num_(a.dress) };
  });
  if (opts.contact) {
    var stu = studentMap_()[id] || {};
    res.parent = (stu.guardian_name || '') + (stu.guardian_relation ? ' (' + stu.guardian_relation + ')' : ''); res.phone = stu.parent_phone;
    res.guardian_name = stu.guardian_name || ''; res.guardian_relation = stu.guardian_relation || '';
    res.editedBy = stu.edited_by || ''; res.editedAt = stu.edited_at || '';
  }
  if (opts.care) res.care = careOf_(id);
  if (!opts.staff) { delete res.reasons; delete res.advice; delete res.lv; }
  return res;
}

/* ===== ข้อมูลย้อนหลังรายปี ===== */
function history_() {
  var cur = year_(), set = {};
  splitList_(cfg_('YEARS')).forEach(function (y) { set[y] = 1; });
  set[cur] = 1;
  var stats = rows_('AttendanceStats'), beh = rows_('BehaviorLog'), hist = rows_('StudentHistory');
  stats.forEach(function (a) { if (a.year) set[a.year] = 1; });
  return Object.keys(set).sort().map(function (y) {
    var P = 0, D = 0, minus = 0, plus = 0;
    stats.forEach(function (a) { if (a.year !== y) return; P += num_(a.present) + num_(a.official) + num_(a.late); D += num_(a.days); });
    beh.forEach(function (b) { if (b.year !== y || b.status === 'void' || b.item_id === 'OPEN') return; if (num_(b.points) < 0) minus++; else plus++; });
    var n = y === cur ? summary_().length : hist.filter(function (h) { return h.year === y; }).length;
    return { year: y, current: y === cur, students: n || null, attRate: D ? round1_(P / D * 100) : null, minus: minus, plus: plus,
             shield: shieldCalc_(y, y === cur ? summary_() : null).overall };
  });
}
