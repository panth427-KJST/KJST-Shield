/********************************************************************
 * Requests.gs — คำขอตัดคะแนน รอแอดมินอนุมัติก่อนตัดจริง
 *  ที่มา: (1) KJST Attendance ชีต _เสนอตัดคะแนน (ทรงผมไม่ผ่านถึงวันที่ 3 · แต่งกายผิดระเบียบครบ 3 ครั้ง) — ครูที่ปรึกษากดส่ง
 *         (2) ครูที่ปรึกษา/หัวหน้าระดับ เสนอใน Shield (สิทธิ์ score.propose · เฉพาะห้อง/ระดับของตน)
 *  แอดมิน (score.record): อนุมัติ (เลือก/แก้รายการ + มาตรการ) → BehaviorLog + MeasureLog · ไม่อนุมัติ (ต้องมีเหตุผล)
 *  รายการตามเกณฑ์ของแต่งกาย/ทรงผม: "<DRESS_LADDER_NAME> (ครั้งที่ 3/4/5)" ตามจำนวนคำขอที่อนุมัติแล้วในปีการศึกษา
 ********************************************************************/

var REQ_EXT_SHEET = '_เสนอตัดคะแนน';
var REQ_KINDS_AUTO = ['แต่งกาย', 'ทรงผม'];

/** รายการคะแนนตามเกณฑ์ (ขั้นบันได) ของนักเรียนคนนี้ */
function ladderItem_(sid, items, reqs) {
  var name = String(cfg_('DRESS_LADDER_NAME') || 'เครื่องแต่งกายหรือทรงผม');
  var done = (reqs || rows_('ScoreRequests')).filter(function (r) {
    return r.student_id === sid && r.status === 'approved' && REQ_KINDS_AUTO.indexOf(r.kind) >= 0 && yearOfReq_(r) === year_();
  }).length;
  var step = Math.min(3 + done, 5), list = (items || scoreItems_(false)).filter(function (i) { return i.type === 'หัก' && i.item_name.indexOf(name) >= 0; });
  var hit = list.filter(function (i) { return i.item_name.replace(/\s/g, '').indexOf('ครั้งที่' + step + ')') >= 0; })[0];
  return { item_id: hit ? hit.item_id : '', step: step };
}
function yearOfReq_(r) { return String(r.ext_ref || '').split('|')[1] || year_(); }

/** ดึงคำขอใหม่จาก KJST Attendance (ภาคเรียนปัจจุบัน) */
function pullRequests_() {
  var src = attSources_(true).filter(function (s) { return s.year === year_() && s.term === term_(); })[0];
  if (!src) return 0;
  var sh = SpreadsheetApp.openById(src.file_id).getSheetByName(REQ_EXT_SHEET);
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getDataRange().getDisplayValues(), h = v[0].map(function (x) { return String(x).trim(); });
  var g = function (r, k) { var i = h.indexOf(k); return i >= 0 ? str_(r[i]) : ''; };
  var have = {}; rows_('ScoreRequests').forEach(function (r) { if (r.ext_ref) have[r.ext_ref.split('|')[0]] = 1; });
  var stu = studentMap_(), add = [];
  v.slice(1).forEach(function (r) {
    var rid = g(r, 'req_id'), sid = sid_(g(r, 'student_id'));
    if (!rid || have[rid] || !sid || g(r, 'status') === 'void') return;
    var s = stu[sid] || {};
    add.push({ req_id: 'R' + rid, source: 'KJST Attendance', kind: g(r, 'kind'), student_id: sid, grade: s.grade || '', room: s.room || '',
               date: normDate_(g(r, 'date')) || g(r, 'date'), item_id: '', evidence: g(r, 'evidence'), note: g(r, 'note'),
               proposed_by: g(r, 'proposed_by'), proposed_at: g(r, 'proposed_at'), status: 'pending', ext_ref: rid + '|' + src.year });
    have[rid] = 1;
  });
  if (add.length) lock_(function () { append_('ScoreRequests', add); });
  return add.length;
}

/** ครูเสนอตัดคะแนน */
function proposeScore_(u, p) {
  var item = scoreItems_(false).filter(function (i) { return i.item_id === p.item_id && i.type === 'หัก'; })[0];
  if (!item) throw err_('INPUT', 'กรุณาเลือกรายการหักคะแนน');
  var note = String(p.note || '').trim();
  if (note.length < 3) throw err_('INPUT', 'กรุณาระบุรายละเอียด/หลักฐานของพฤติกรรม');
  var date = normDate_(p.date) || today_();
  if (date > today_()) throw err_('INPUT', 'ไม่สามารถเสนอวันที่ล่วงหน้าได้');
  var ids = uniq_([].concat(p.ids || []).map(sid_).filter(Boolean));
  if (!ids.length) throw err_('INPUT', 'กรุณาเลือกนักเรียน');
  var stu = studentMap_(), cs = careScope_(u), stamp = now_(), tag = Date.now().toString(36), add = [], skip = [];
  ids.forEach(function (id, i) {
    var s = stu[id];
    if (!s || !isActiveStudent_(s) || !inScope_(cs, s.grade, s.room)) { skip.push(id); return; }
    add.push({ req_id: 'T' + tag + '_' + i, source: 'ครู', kind: 'ครูเสนอ', student_id: id, grade: s.grade, room: s.room, date: date,
               item_id: item.item_id, evidence: item.item_name, note: note.slice(0, 500), proposed_by: by_(u), proposed_at: stamp, status: 'pending' });
  });
  if (!add.length) throw err_('INPUT', 'เสนอได้เฉพาะนักเรียนในห้อง/ระดับชั้นที่ดูแล');
  lock_(function () { append_('ScoreRequests', add); });
  audit_(by_(u), 'proposeScore', { item: item.item_id, n: add.length });
  return { count: add.length, skipped: skip.length };
}

/** รายการคำขอ: แอดมินเห็นทั้งหมด · ครูเห็นของห้อง/ระดับที่ดูแล */
function requestsList_(u, p) {
  var admin = can_(u, 'score.record');
  if (admin && p.pull) { try { pullRequests_(); } catch (e) { Logger.log('pullRequests: ' + e.message); } }
  var status = String(p.status || 'pending'), cs = careScope_(u), stu = studentMap_(), items = scoreItems_(false), all = rows_('ScoreRequests');
  var itemMap = {}; scoreItems_(true).forEach(function (i) { itemMap[i.item_id] = i; });
  var list = all.filter(function (r) {
    if (status !== 'all' && r.status !== status) return false;
    if (admin) return true;
    return inScope_(cs, r.grade, r.room) || String(r.proposed_by).indexOf('(' + u.id + ')') >= 0;
  }).map(function (r) {
    var s = stu[r.student_id] || {}, sug = r.item_id ? { item_id: r.item_id } : ladderItem_(r.student_id, items, all);
    var it = itemMap[r.decided_item_id || sug.item_id] || {};
    return { req_id: r.req_id, source: r.source, kind: r.kind, student_id: r.student_id, name: fullName_(s) || r.student_id, cls: cls_(r.grade, r.room),
             date: r.date, evidence: r.evidence, note: r.note, proposed_by: r.proposed_by, proposed_at: r.proposed_at, status: r.status,
             item_id: r.decided_item_id || sug.item_id || '', item_name: it.item_name || '', points: it.points || '', step: sug.step || '',
             measures: r.status === 'pending' ? (it.measures || []) : splitList_(r.measures), decided_by: r.decided_by, decided_at: r.decided_at, decide_note: r.decide_note };
  }).sort(function (a, b) { return a.proposed_at < b.proposed_at ? 1 : -1; });
  return { admin: admin, list: list.slice(0, 500), pending: all.filter(function (r) { return r.status === 'pending'; }).length };
}

/** แอดมิน: อนุมัติ / ไม่อนุมัติ */
function decideRequest_(u, p) {
  var ok = p.decision === 'approve', note = String(p.note || '').trim();
  if (!ok && note.length < 3) throw err_('INPUT', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  var cur = rows_('ScoreRequests').filter(function (r) { return r.req_id === p.req_id; })[0];
  if (!cur) throw err_('NOTFOUND', 'ไม่พบคำขอ');
  if (cur.status !== 'pending') throw err_('CONFLICT', 'คำขอนี้ได้รับการพิจารณาไปแล้ว');
  var upd = { status: ok ? 'approved' : 'rejected', decided_by: by_(u), decided_at: now_(), decide_note: note.slice(0, 500) };
  var item = null;
  if (ok) {
    item = scoreItems_(false).filter(function (i) { return i.item_id === p.item_id && i.type === 'หัก'; })[0];
    if (!item) throw err_('INPUT', 'กรุณาเลือกรายการหักคะแนน');
  }
  lock_(function () {
    dirty_('ScoreRequests');
    var again = rows_('ScoreRequests').filter(function (r) { return r.req_id === p.req_id; })[0];
    if (again.status !== 'pending') throw err_('CONFLICT', 'คำขอนี้ได้รับการพิจารณาไปแล้ว');
    if (ok) {
      var date = again.date && again.date <= today_() ? again.date : today_();
      var txt = [again.kind !== 'ครูเสนอ' ? 'ผลตรวจ' + again.kind : 'ครูเสนอ', again.evidence, again.note, note].filter(Boolean).join(' · ');
      var r = createScores_(u, item, [again.student_id], date, txt, p.measures, { requestId: again.req_id, noLock: true });
      upd.decided_item_id = item.item_id; upd.decided_points = r.points; upd.measures = r.measures.join(', '); upd.log_id = r.logs[0].log_id;
    }
    updateRows_('ScoreRequests', [Object.assign({}, again, upd)]);
  });
  audit_(by_(u), 'decideRequest', { req: p.req_id, decision: upd.status });
  return { status: upd.status };
}

function pendingRequests_() { return rows_('ScoreRequests').filter(function (r) { return r.status === 'pending'; }).length; }
