/********************************************************************
 * Scores.gs — บันทึก/ยกเลิกคะแนน และปรับเกณฑ์ (ScoreItems, CertRules)
 ********************************************************************/

function scoreItems_(includeInactive) {
  var MS = measures_();
  return rows_('ScoreItems').filter(function (r) { return r.item_id && (includeInactive || bool_(r.active)); })
    .map(function (r) {
      return { item_id: r.item_id, type: r.type, category: r.category, item_name: r.item_name, points: num_(r.points),
               measures: r.type === 'หัก' ? suggestMeasures_(r.guidance, MS) : [],
               guidance: r.guidance, is_severe: bool_(r.is_severe), active: bool_(r.active), sort_order: num_(r.sort_order, 999),
               updated_by: r.updated_by, updated_at: r.updated_at };
    })
    .sort(function (a, b) { return a.type === b.type ? a.sort_order - b.sort_order || a.item_id.localeCompare(b.item_id) : (a.type === 'หัก' ? -1 : 1); });
}

function certRules_() {
  return rows_('CertRules').filter(function (r) { return r.label; }).map(function (r) {
    return { min: r.min_score === '' ? null : num_(r.min_score), max: r.max_score === '' ? null : num_(r.max_score),
             label: r.label, issue: bool_(r.issue_cert), sort: num_(r.sort_order, 99) };
  }).sort(function (a, b) { return a.sort - b.sort; });
}
function certOf_(score, rules) {
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    if ((r.min === null || score >= r.min) && (r.max === null || score <= r.max)) return r;
  }
  return { label: '-', issue: false };
}

/** บันทึกคะแนน: คะแนนมาจาก ScoreItems ฝั่งเซิร์ฟเวอร์เท่านั้น */
function addScore_(u, p) {
  var item = scoreItems_(false).filter(function (i) { return i.item_id === p.item_id; })[0];
  if (!item) throw err_('INPUT', 'ไม่พบรายการคะแนนนี้ หรือรายการถูกปิดใช้งานแล้ว');
  var ids = uniq_([].concat(p.ids || []).map(sid_).filter(Boolean));
  if (!ids.length) throw err_('INPUT', 'กรุณาเลือกนักเรียนอย่างน้อย 1 คน');
  if (ids.length > 300) throw err_('INPUT', 'บันทึกได้ครั้งละไม่เกิน 300 คน');
  var date = normDate_(p.date) || today_();
  if (date > today_()) throw err_('INPUT', 'ไม่สามารถบันทึกวันที่ล่วงหน้าได้');
  var r = createScores_(u, item, ids, date, p.note, p.measures, {});
  return { count: r.logs.length, missing: r.missing, points: r.points, item: item.item_name, measures: r.measures };
}

/** บันทึกคะแนน (ใช้ร่วมกับการอนุมัติคำขอ) → BehaviorLog + MeasureLog */
function createScores_(u, item, ids, date, note, measureIds, opt) {
  var ms = pickMeasures_(measureIds, item.type);
  var stu = studentMap_(), sc = scope_(u), stamp = now_(), tag = Date.now().toString(36), y = year_(), t = term_();
  var pts = item.type === 'หัก' ? -Math.abs(item.points) : Math.abs(item.points), by = u.name + ' (' + u.id + ')';
  var logs = [], missing = [];
  ids.forEach(function (id, i) {
    var s = stu[id];
    if (!s || !isActiveStudent_(s) || !inScope_(sc, s.grade, s.room)) { missing.push(id); return; }
    logs.push({
      log_id: 'L' + tag + '_' + i, date: date, year: y, term: t, student_id: id, grade: s.grade, room: s.room, stage: stage_(s.grade),
      item_id: item.item_id, type: item.type, category: item.category, item_name: item.item_name, points: pts,
      severe: item.is_severe ? 'TRUE' : 'FALSE', note: String(note || '').slice(0, 500),
      recorded_by: by, recorded_at: stamp, status: 'active', measures: ms.map(function (m) { return m.name; }).join(', '), request_id: opt.requestId || ''
    });
  });
  if (!logs.length) throw err_('INPUT', 'ไม่พบนักเรียนที่เลือก');
  var mrows = measureRows_(logs, ms, by, stamp);
  var write = function () { append_('BehaviorLog', logs); append_('MeasureLog', mrows); };
  if (opt.noLock) write(); else lock_(write);
  bumpSummary_();
  return { logs: logs, missing: missing, points: pts, measures: ms.map(function (m) { return m.name; }) };
}

function voidScore_(u, p) {
  var reason = String(p.reason || '').trim();
  if (reason.length < 3) throw err_('INPUT', 'กรุณาระบุเหตุผลที่ยกเลิก');
  return lock_(function () {
    dirty_('BehaviorLog');
    var row = rows_('BehaviorLog').filter(function (b) { return b.log_id === p.log_id; })[0];
    if (!row) throw err_('NOTFOUND', 'ไม่พบรายการนี้');
    if (row.status === 'void') throw err_('INPUT', 'รายการนี้ถูกยกเลิกไปแล้ว');
    updateRows_('BehaviorLog', [Object.assign({}, row, { status: 'void', void_by: u.name + ' (' + u.id + ')', void_at: now_(), void_reason: reason.slice(0, 300) })]);
    var ml = rows_('MeasureLog').filter(function (m) { return m.log_id === row.log_id && m.status !== 'void'; })
      .map(function (m) { return Object.assign({}, m, { status: 'void' }); });
    updateRows_('MeasureLog', ml);
    bumpSummary_();
    return true;
  });
}

function recentScores_(u, p) {
  var stu = studentMap_(), limit = Math.min(Number(p.limit) || 100, 500);
  var list = rows_('BehaviorLog');
  return list.slice(-limit).reverse().map(function (b) {
    var s = stu[b.student_id];
    return { log_id: b.log_id, date: b.date, student_id: b.student_id, name: s ? fullName_(s) : b.student_id, cls: cls_(b.grade, b.room),
             item: b.item_name, type: b.type, points: num_(b.points), note: b.note, by: b.recorded_by, at: b.recorded_at, measures: b.measures,
             status: b.status, void_by: b.void_by, void_reason: b.void_reason };
  });
}

/* ===== ปรับเกณฑ์ (ผู้ดูแลระบบ) ===== */
function rulesLog_(by, table, key, before, after, fields) {
  var logs = [], at = now_();
  fields.forEach(function (f) {
    var o = before ? str_(before[f]) : '', n = str_(after[f]);
    if (o !== n) logs.push({ at: at, by: by, table: table, key: key, field: f, old_value: o, new_value: n });
  });
  append_('RulesLog', logs);
  return logs.length;
}

function rulesSaveItem_(u, p) {
  var type = p.type === 'เพิ่ม' ? 'เพิ่ม' : 'หัก';
  var name = String(p.item_name || '').trim(), pts = Math.abs(Math.round(Number(p.points)));
  if (!name) throw err_('INPUT', 'กรุณาระบุชื่อรายการ');
  if (!(pts > 0 && pts <= 100)) throw err_('INPUT', 'คะแนนต้องเป็นจำนวนเต็ม 1–100');
  var by = u.name + ' (' + u.id + ')';
  return lock_(function () {
    dirty_('ScoreItems');
    var all = rows_('ScoreItems'), cur = p.item_id ? all.filter(function (r) { return r.item_id === p.item_id; })[0] : null;
    if (p.item_id && !cur) throw err_('NOTFOUND', 'ไม่พบรายการ ' + p.item_id);
    if (p.item_id && all.filter(function (r) { return r.item_id === p.item_id; }).length > 1) throw err_('INPUT', 'รหัส ' + p.item_id + ' ซ้ำกันในชีต ScoreItems กรุณาแจ้งผู้ดูแลระบบ');
    if (cur && cur.type !== type) throw err_('INPUT', 'เปลี่ยนประเภทหัก/เพิ่มของรายการเดิมไม่ได้ ให้ปิดรายการเดิมแล้วสร้างรายการใหม่');
    var id = cur ? cur.item_id : (function () {
      // รหัสใหม่ = เลขสูงสุด + 1 (อย่างน้อย 2 หลัก ไม่จำกัดจำนวน: D99 → D100 → D101 ...)
      var pre = type === 'หัก' ? 'D' : 'P', max = 0, used = {};
      all.forEach(function (r) {
        used[r.item_id] = 1;
        if (r.item_id.charAt(0) === pre && /^\d+$/.test(r.item_id.slice(1))) max = Math.max(max, Number(r.item_id.slice(1)));
      });
      var n = max + 1, nid;
      do { nid = pre + (n < 10 ? '0' + n : String(n)); n++; } while (used[nid]);
      return nid;
    })();
    var o = {
      item_id: id, type: type, category: String(p.category || '').trim() || 'อื่น ๆ', item_name: name, points: String(pts),
      guidance: String(p.guidance || '').trim(), is_severe: p.is_severe ? 'TRUE' : 'FALSE', active: p.active === false ? 'FALSE' : 'TRUE',
      sort_order: String(num_(p.sort_order, cur ? num_(cur.sort_order, 99) : all.length + 1)), updated_by: by, updated_at: now_()
    };
    rulesLog_(by, 'ScoreItems', id, cur, o, ['category', 'item_name', 'points', 'guidance', 'is_severe', 'active', 'sort_order']);
    if (cur) updateRows_('ScoreItems', [Object.assign({}, cur, o)]); else append_('ScoreItems', [o]);
    bumpSummary_();
    return { item_id: id };
  });
}

/** บันทึกเกณฑ์ใบรับรองทั้งชุด (ตรวจช่วงคะแนนไม่ให้ซ้อนกัน) */
function rulesSaveCert_(u, p) {
  var rows = [].concat(p.rows || []).map(function (r, i) {
    return { min_score: r.min === '' || r.min === null || r.min === undefined ? '' : String(Math.round(Number(r.min))),
             max_score: r.max === '' || r.max === null || r.max === undefined ? '' : String(Math.round(Number(r.max))),
             label: String(r.label || '').trim(), issue_cert: r.issue ? 'TRUE' : 'FALSE', sort_order: String(i + 1) };
  }).filter(function (r) { return r.label; });
  if (rows.length < 2) throw err_('INPUT', 'ต้องมีอย่างน้อย 2 ระดับ');
  rows.forEach(function (r) {
    if ((r.min_score !== '' && isNaN(Number(r.min_score))) || (r.max_score !== '' && isNaN(Number(r.max_score)))) throw err_('INPUT', 'ช่วงคะแนนต้องเป็นตัวเลข');
    if (r.min_score !== '' && r.max_score !== '' && Number(r.min_score) > Number(r.max_score)) throw err_('INPUT', 'ช่วงคะแนนของ "' + r.label + '" ไม่ถูกต้อง');
  });
  for (var s = -50; s <= 200; s++) {
    var hit = rows.filter(function (r) { return (r.min_score === '' || s >= Number(r.min_score)) && (r.max_score === '' || s <= Number(r.max_score)); }).length;
    if (hit > 1) throw err_('INPUT', 'ช่วงคะแนนซ้อนกันที่คะแนน ' + s);
    if (hit === 0) throw err_('INPUT', 'ไม่มีระดับครอบคลุมคะแนน ' + s);
  }
  var by = u.name + ' (' + u.id + ')';
  lock_(function () {
    var before = rows_('CertRules').map(function (r) { return r.label + ':' + r.min_score + '-' + r.max_score + ':' + r.issue_cert; }).join(' | ');
    var after = rows.map(function (r) { return r.label + ':' + r.min_score + '-' + r.max_score + ':' + r.issue_cert; }).join(' | ');
    append_('RulesLog', [{ at: now_(), by: by, table: 'CertRules', key: 'ทั้งชุด', field: 'rows', old_value: before, new_value: after }]);
    writeAll_('CertRules', rows);
  });
  bumpSummary_();
  return true;
}

function rulesLogList_(limit) {
  return rows_('RulesLog').slice(-(limit || 200)).reverse().map(function (r) { delete r._row; return r; });
}
