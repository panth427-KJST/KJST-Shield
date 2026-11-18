/********************************************************************
 * Shield.gs — ตัวชี้วัด KJST SHIELD (S-H-I-E-L-D) และการขึ้นปีการศึกษาใหม่
 ********************************************************************/

function seedShield_(y) {
  if (rows_('ShieldKPI').some(function (r) { return r.year === y; })) return 0;
  return append_('ShieldKPI', SHIELD_SEED.map(function (r) { return { year: y, code: r[0], component: r[1], indicator: r[2], target: r[3], actual: r[4] }; }));
}

function recordCoverage_(y) {
  var res = rows_('AttendanceSources').filter(function (s) { return s.year === y && s.last_result; }).map(function (s) {
    try { return JSON.parse(s.last_result).coverage; } catch (e) { return null; }
  }).filter(function (x) { return x !== null && x !== undefined; });
  return res.length ? round1_(res.reduce(function (a, b) { return a + b; }, 0) / res.length) : 0;
}

function shieldCalc_(y, list) {
  var auto = {};
  if (list) {
    var n = list.length || 1, rated = list.filter(function (s) { return s.rate !== null; });
    auto.AUTO_NORMAL = round1_(list.filter(function (s) { return s.lv === 0; }).length / n * 100);
    auto.AUTO_GOOD = round1_(list.filter(function (s) { return s.score >= 70; }).length / n * 100);
    auto.AUTO_SCORE80 = round1_(list.filter(function (s) { return s.score >= 80; }).length / n * 100);
    auto.AUTO_ATT = rated.length ? round1_(rated.reduce(function (a, s) { return a + s.rate; }, 0) / rated.length) : 0;
    auto.AUTO_RECORD = recordCoverage_(y);
  }
  var comp = {}, items = [];
  rows_('ShieldKPI').filter(function (r) { return r.year === y; }).forEach(function (r) {
    var isAuto = /^AUTO_/.test(r.actual), val = isAuto ? auto[r.actual] : num_(r.actual);
    if (val === undefined) return;
    var tgt = num_(r.target) || 100, pct = Math.max(0, Math.min(100, round1_(val / tgt * 100)));
    items.push({ code: r.code, component: r.component, indicator: r.indicator, target: tgt, actual: val, auto: isAuto, raw: r.actual, pct: pct });
    var c = comp[r.code] = comp[r.code] || { name: r.component, sum: 0, n: 0 };
    c.sum += pct; c.n++;
  });
  var comps = ['S', 'H', 'I', 'E', 'L', 'D'].map(function (k) { var c = comp[k]; return { code: k, name: c ? c.name : '', pct: c ? round1_(c.sum / c.n) : 0, has: !!c }; });
  var used = comps.filter(function (c) { return c.has; });
  return { year: y, items: items, comps: comps, overall: used.length ? round1_(used.reduce(function (a, c) { return a + c.pct; }, 0) / used.length) : null };
}

function shieldSave_(u, p) {
  var y = year_(), map = {}, by = u.name + ' (' + u.id + ')';
  (p.items || []).forEach(function (it) { map[it.code + '|' + it.indicator] = it; });
  return lock_(function () {
    var upd = [];
    rows_('ShieldKPI').forEach(function (r) {
      var it = r.year === y ? map[r.code + '|' + r.indicator] : null;
      if (!it) return;
      var next = Object.assign({}, r), t = Number(it.target);
      if (t > 0) next.target = String(t);
      if (!/^AUTO_/.test(r.actual)) { var a = Number(it.actual); if (!isNaN(a)) next.actual = String(a); }
      if (next.target !== r.target || next.actual !== r.actual) upd.push(next);
    });
    updateRows_('ShieldKPI', upd);
    audit_(by, 'shieldSave', { changed: upd.length });
    return { changed: upd.length };
  });
}

function newYear_(u, p) {
  var ny = String(p.year || '').replace(/\D/g, ''), cur = year_(), by = u.name + ' (' + u.id + ')';
  if (ny.length !== 4 || Number(ny) <= Number(cur)) throw err_('INPUT', 'ปีการศึกษาใหม่ต้องมากกว่า ' + cur);
  return lock_(function () {
    if (!rows_('StudentHistory').some(function (h) { return h.year === cur; })) {
      append_('StudentHistory', rows_('Students').map(function (s) {
        return { year: cur, student_id: s.student_id, name: fullName_(s), grade: s.grade, room: s.room, status: s.status };
      }));
    }
    setCfg_('YEAR', ny); setCfg_('TERM', '1');
    var ys = splitList_(cfg_('YEARS')); if (ys.indexOf(ny) < 0) ys.push(ny);
    setCfg_('YEARS', ys.join(','));
    seedShield_(ny);
    bumpSummary_();
    audit_(by, 'newYear', { from: cur, to: ny });
    return { msg: 'เริ่มปีการศึกษา ' + ny + ' แล้ว รายชื่อปี ' + cur + ' ถูกเก็บใน StudentHistory — ขั้นต่อไป: วาง DMC ปีใหม่แล้วนำเข้า และเพิ่มไฟล์ E-Attendance ภาค 1/' + ny };
  });
}
