/********************************************************************
 * Summary.gs — คำนวณสรุปรายนักเรียน (คะแนน เวลาเรียน ระดับความเสี่ยง ผลรับรอง)
 *  ผลทั้งโรงเรียนเก็บใน CacheService พร้อมเลขเวอร์ชัน (SUM_VER)
 *  ทุกการบันทึก/ยกเลิกคะแนน นำเข้า หรือดึงข้อมูลเช็กชื่อ จะเพิ่มเลขเวอร์ชัน → คำนวณใหม่ครั้งถัดไป 1 ครั้ง
 ********************************************************************/

function sumVer_() { return props_().getProperty('SUM_VER') || '1'; }
function bumpSummary_() { props_().setProperty('SUM_VER', String(Number(sumVer_()) + 1)); delete MEMO_._sum; }

function summary_() {
  if (MEMO_._sum) return MEMO_._sum;
  var key = 'SUM_' + sumVer_() + '_' + year_();
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
  var certs = certRules_(), studs = activeStudents_(), st = {};
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
    if (x.dress >= T.dress) flag(1, 'ผิดระเบียบแต่งกาย/ทรงผม ' + x.dress + ' ครั้ง', 'ตักเตือน ชี้แจงผู้ปกครอง ประสานกองทุนชุดนักเรียนหากขาดแคลน');
    Object.keys(x.sev).forEach(function (k) { flag(2, 'พฤติกรรมเสี่ยง: ' + k + ' (' + x.sev[k] + ' ครั้ง)', 'ส่งต่อครูแนะแนว/ฝ่ายปกครอง และหน่วยงานภายนอกตามความเหมาะสม'); });
    var cert = certOf_(score, certs);
    return {
      id: s.student_id, no: num_(s.number, 999), name: fullName_(s), g: s.grade, r: s.room, sex: s.gender, stage: x.stage,
      score: score, plus: x.plus, minus: x.minus, P: x.P, O: x.O, LV: x.LV, L: x.L, A: x.A, days: x.D, rate: rate, dress: x.dress,
      lv: lv, reasons: reasons, advice: advice, cert: cert.label, certOk: cert.issue
    };
  });
}

function scoped_(u) { var sc = scope_(u); return summary_().filter(function (s) { return inScope_(sc, s.g, s.r); }); }

/* ===== แดชบอร์ด ===== */
function dashboard_(u) {
  var list = scoped_(u), L = [0, 0, 0, 0], male = 0, female = 0, sumR = 0, nR = 0, sumS = 0, byGrade = {}, certCount = {};
  list.forEach(function (s) {
    L[s.lv]++;
    if (s.sex === 'ชาย') male++; else if (s.sex === 'หญิง') female++;
    if (s.rate !== null) { sumR += s.rate; nR++; }
    sumS += s.score;
    var g = byGrade[s.g] = byGrade[s.g] || { grade: s.g, n: 0, lv: [0, 0, 0, 0] };
    g.n++; g.lv[s.lv]++;
    certCount[s.cert] = (certCount[s.cert] || 0) + 1;
  });
  var today = today_(), sc = scope_(u), sm = {};
  list.forEach(function (s) { sm[s.id] = s; });
  var todayList = rows_('AttendanceDaily').filter(function (d) { return d.date === today && sm[d.student_id]; }).map(function (d) {
    return { id: d.student_id, name: sm[d.student_id].name, cls: cls_(d.grade, d.room), status: d.status, dress: d.dress_items };
  });
  var att = {}; try { att = JSON.parse(cfg_('ATT_TODAY') || '{}'); } catch (e) {}
  var cm = classMap_(), myRooms = [];
  Object.keys(cm).forEach(function (g) { cm[g].forEach(function (r) { if (inScope_(sc, g, r)) myRooms.push(cls_(g, r)); }); });
  var reported = att.date === today ? (att.rooms || []).filter(function (r) { return myRooms.indexOf(r) >= 0; }).length : 0;
  return {
    year: year_(), term: term_(), today: today, total: list.length, male: male, female: female, levels: L,
    avgRate: nR ? round1_(sumR / nR) : null, avgScore: list.length ? round1_(sumS / list.length) : null,
    byGrade: Object.keys(byGrade).sort(function (a, b) { return gnum_(a) - gnum_(b); }).map(function (k) { return byGrade[k]; }),
    certs: certRules_().map(function (c) { return { label: c.label, issue: c.issue, min: c.min, max: c.max, n: certCount[c.label] || 0 }; }),
    alerts: list.filter(function (s) { return s.lv > 0; }).sort(function (a, b) { return b.lv - a.lv || a.score - b.score; }).slice(0, 300)
      .map(function (s) { return { id: s.id, name: s.name, cls: cls_(s.g, s.r), score: s.score, rate: s.rate, lv: s.lv, reasons: s.reasons, advice: s.advice }; }),
    todayList: todayList, roomsTotal: myRooms.length, roomsReported: reported, attUpdated: att.at || '',
    shield: shieldCalc_(year_(), summary_()).overall
  };
}

/* ===== รายชื่อนักเรียน (แบบย่อ) ===== */
function studentsList_(u) {
  return scoped_(u).map(function (s) {
    return { id: s.id, no: s.no, name: s.name, g: s.g, r: s.r, score: s.score, rate: s.rate, lv: s.lv, cert: s.cert, certOk: s.certOk, A: s.A, L: s.L };
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
  res.terms = rows_('AttendanceStats').filter(function (a) { return a.student_id === id; }).map(function (a) {
    return { year: a.year, term: a.term, present: num_(a.present), official: num_(a.official), leave: num_(a.leave), late: num_(a.late), absent: num_(a.absent), days: num_(a.days), dress: num_(a.dress) };
  });
  if (opts.contact) {
    var stu = studentMap_()[id] || {};
    res.parent = (stu.guardian_name || '') + (stu.guardian_relation ? ' (' + stu.guardian_relation + ')' : ''); res.phone = stu.parent_phone;
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
