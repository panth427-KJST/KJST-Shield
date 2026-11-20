/********************************************************************
 * Api.gs — Web App: doPost (JSON API สำหรับหน้าเว็บบน GitHub Pages)
 *  body: {"action": "...", "session": "...", ...}
 *  ตอบ: {"ok": true, "data": ...} | {"ok": false, "error": "...", "code": "AUTH|PERM|INPUT|NOTFOUND|LOCKED|SERVER"}
 ********************************************************************/

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() {
  return json_({ ok: true, data: { app: 'KJST Shield API', version: VERSION } });
}

function doPost(e) {
  var p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (x) { return json_({ ok: false, error: 'คำขอไม่ถูกต้อง', code: 'INPUT' }); }
  return json_(handle_(p));
}

/** ใช้ได้ทั้งจาก doPost และจากการทดสอบใน editor */
function handle_(p) {
  try {
    var a = PUBLIC_ACTIONS[p.action];
    if (a) return { ok: true, data: a(p) };
    var u = getSession_(p.session);
    if (!u) return { ok: false, error: 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่', code: 'AUTH' };
    if (p.action === 'logout') { dropSession_(p.session); return { ok: true, data: true }; }
    if (u.kind === 'student') {
      var sa = STUDENT_ACTIONS[p.action];
      if (!sa) return { ok: false, error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้', code: 'PERM' };
      return { ok: true, data: sa(u, p) };
    }
    var def = ACTIONS[p.action];
    if (!def) return { ok: false, error: 'ไม่พบคำสั่ง ' + p.action, code: 'INPUT' };
    if (def.perm) need_(u, def.perm);
    return { ok: true, data: def.fn(u, p) };
  } catch (e) {
    var code = e.code || 'SERVER';
    if (code === 'SERVER') Logger.log('[' + p.action + '] ' + (e.stack || e.message));
    return { ok: false, error: code === 'SERVER' ? 'ระบบขัดข้อง: ' + e.message : e.message, code: code };
  }
}

function by_(u) { return u.name + ' (' + u.id + ')'; }

var PUBLIC_ACTIONS = {
  ping: function () { return { version: VERSION, school: cfg_('SCHOOL_NAME'), year: year_(), term: term_(), clientId: cfg_('GOOGLE_CLIENT_ID') }; },
  loginGoogle: loginGoogle_,
  loginPassword: loginPassword_,
  loginStudent: loginStudent_
};

var STUDENT_ACTIONS = {
  init: function (u) { return { user: publicUser_(u), school: cfg_('SCHOOL_NAME'), year: year_(), term: term_(), version: VERSION }; },
  myReport: function (u) { return studentDetail_(u.id, { staff: false, contact: false, care: false }); }
};

var ACTIONS = {
  init: { perm: null, fn: function (u) {
    var sc = scope_(u), cm = classMap_(), classes = {};
    Object.keys(cm).forEach(function (g) { var rs = cm[g].filter(function (r) { return inScope_(sc, g, r); }); if (rs.length) classes[g] = rs; });
    return { user: publicUser_(u), school: cfg_('SCHOOL_NAME'), year: year_(), term: term_(), version: VERSION,
             classes: classes, careClasses: careClassList_(u, cm), careKinds: CARE_KINDS, careStatus: CARE_STATUS,
             pendingRequests: can_(u, 'score.record') ? pendingRequests_() : 0 };
  } },

  dashboard:    { perm: 'dashboard.view', fn: function (u) { return dashboard_(u); } },
  myClass:      { perm: 'dashboard.view', fn: function (u, p) { return myClass_(u, p); } },
  studentSave:  { perm: 'student.edit', fn: function (u, p) { return studentSave_(u, p); } },
  studentTypeBulk: { perm: 'student.edit', fn: function (u, p) { return studentTypeBulk_(u, p); } },
  measures:     { perm: null, fn: function () { return measures_(); } },
  proposeScore: { perm: 'score.propose', fn: function (u, p) { return proposeScore_(u, p); } },
  requests:     { perm: null, fn: function (u, p) { if (!can_(u, 'score.record') && !can_(u, 'score.propose')) throw err_('PERM', 'ไม่มีสิทธิ์ใช้งานส่วนนี้'); return requestsList_(u, p); } },
  decideRequest:{ perm: 'score.record', fn: function (u, p) { return decideRequest_(u, p); } },
  reportList:   { perm: 'score.record', fn: function (u, p) { return reportList_(p); } },
  reportDoc:    { perm: 'score.record', fn: function (u, p) { return reportDoc_(p); } },
  docSave:      { perm: 'score.record', fn: function (u, p) { return docSave_(u, p); } },
  docSignersSave: { perm: 'score.record', fn: function (u, p) { return docSignersSave_(u, p); } },
  recAttGet:    { perm: 'records.edit', fn: function (u, p) { return recAttGet_(p); } },
  recAttSave:   { perm: 'records.edit', fn: function (u, p) { return recAttSave_(u, p); } },
  recDressGet:  { perm: 'records.edit', fn: function (u, p) { return recDressGet_(p); } },
  recDressSave: { perm: 'records.edit', fn: function (u, p) { return recDressSave_(u, p); } },
  recHairGet:   { perm: 'records.edit', fn: function (u, p) { return recHairGet_(p); } },
  recHairSave:  { perm: 'records.edit', fn: function (u, p) { return recHairSave_(u, p); } },
  recLog:       { perm: 'records.edit', fn: function (u, p) { return recLog_(p); } },
  history:      { perm: 'dashboard.view', fn: function () { return history_(); } },
  students:     { perm: 'student.view', fn: function (u) { return studentsList_(u); } },
  student:      { perm: 'student.view', fn: function (u, p) {
    var id = sid_(p.id), s = summary_().filter(function (x) { return x.id === id; })[0];
    if (!s || !inScope_(scope_(u), s.g, s.r)) throw err_('PERM', 'ไม่มีสิทธิ์ดูข้อมูลนักเรียนคนนี้');
    var contact = can_(u, 'student.contact');
    return studentDetail_(id, { staff: true, contact: contact, care: contact });
  } },

  scoreItems:   { perm: null, fn: function () { return scoreItems_(false); } },
  addScore:     { perm: 'score.record', fn: function (u, p) { return addScore_(u, p); } },
  voidScore:    { perm: 'score.void', fn: function (u, p) { return voidScore_(u, p); } },
  recentScores: { perm: 'score.record', fn: function (u, p) { return recentScores_(u, p); } },

  careList:     { perm: 'student.view', fn: function (u, p) { return careList_(u, p); } },
  careAdd:      { perm: 'care.record', fn: function (u, p) { return careAdd_(u, p); } },
  careUpdate:   { perm: 'care.record', fn: function (u, p) { return careUpdate_(u, p); } },

  rulesGet:      { perm: 'rules.edit', fn: function () { return { items: scoreItems_(true), certs: certRules_() }; } },
  rulesSaveItem: { perm: 'rules.edit', fn: function (u, p) { return rulesSaveItem_(u, p); } },
  rulesSaveCert: { perm: 'rules.edit', fn: function (u, p) { return rulesSaveCert_(u, p); } },
  rulesLog:      { perm: 'rules.edit', fn: function () { return rulesLogList_(200); } },

  usersList:     { perm: 'users.manage', fn: function () { return usersList_(); } },
  usersSync:     { perm: 'users.manage', fn: function (u) { return syncUsers_(by_(u)); } },
  usersSeedRoles:{ perm: 'users.manage', fn: function (u, p) { return seedRoles_(by_(u), !!p.force); } },
  usersSave:     { perm: 'users.manage', fn: function (u, p) { return usersSave_(u.id, p); } },
  permissions:   { perm: 'users.manage', fn: function () { return rows_('Permissions').map(function (r) { delete r._row; return r; }); } },

  studentsSync:  { perm: 'data.import', fn: function (u) { return syncStudents_(by_(u)); } },
  importDMC:     { perm: 'data.import', fn: function (u, p) { return importDMC_(by_(u), p.removeSheet !== false); } },
  studentsNoAuth:{ perm: 'data.import', fn: function () { return studentsNoAuth_(); } },
  setStudentAuth:{ perm: 'data.import', fn: function (u, p) { return setStudentAuth_(by_(u), p); } },
  importOpening: { perm: 'data.import', fn: function (u) { return importOpening_(by_(u)); } },
  attendancePull:{ perm: 'data.import', fn: function (u) { return pullAttendance_(by_(u)); } },
  attendanceSources:    { perm: 'data.import', fn: function () { return rows_('AttendanceSources').map(function (r) { delete r._row; return r; }); } },
  attendanceSourceSave: { perm: 'data.import', fn: function (u, p) { return attendanceSourceSave_(by_(u), p); } },

  settingsGet:  { perm: 'settings.manage', fn: function () { return settingsGet_(); } },
  settingsSave: { perm: 'settings.manage', fn: function (u, p) { return settingsSave_(u, p); } },
  newYear:      { perm: 'settings.manage', fn: function (u, p) { return newYear_(u, p); } },

  shield:       { perm: 'dashboard.view', fn: function (u) { var r = shieldCalc_(year_(), summary_()); r.editable = can_(u, 'shield.edit'); return r; } },
  shieldSave:   { perm: 'shield.edit', fn: function (u, p) { return shieldSave_(u, p); } }
};

function careClassList_(u, cm) {
  var cs = careScope_(u), out = [];
  Object.keys(cm).forEach(function (g) { cm[g].forEach(function (r) { if (inScope_(cs, g, r)) out.push(cls_(g, r)); }); });
  return out;
}

var SETTING_KEYS = ['YEAR', 'TERM', 'RISK_CRITICAL', 'RISK_HIGH', 'RISK_WATCH', 'ATT_MIN', 'ATT_NEAR', 'MIN_DAYS', 'ABSENT_WATCH', 'LATE_WATCH', 'DRESS_WATCH', 'YEARS', 'GOOGLE_CLIENT_ID', 'ATT_WEB_URL'];

function settingsGet_() {
  var c = cfgAll_(), o = {};
  SETTING_KEYS.forEach(function (k) { o[k] = c[k]; });
  return {
    values: o, notes: CONFIG_DEFAULTS.reduce(function (m, d) { m[d[0]] = d[2]; return m; }, {}),
    students: activeStudents_().length, users: rows_('Users_Shield').length, sumVer: sumVer_(),
    sources: rows_('AttendanceSources').map(function (r) { delete r._row; return r; })
  };
}

function settingsSave_(u, p) {
  var v = p.values || {}, changed = [];
  SETTING_KEYS.forEach(function (k) {
    if (v[k] === undefined || k === 'YEAR') return;           // เปลี่ยนปีการศึกษาใช้ newYear
    var val = String(v[k]).trim();
    if (k === 'TERM' && ['1', '2'].indexOf(val) < 0) throw err_('INPUT', 'ภาคเรียนต้องเป็น 1 หรือ 2');
    if (/^(RISK|ATT|MIN|ABSENT|LATE|DRESS)/.test(k) && isNaN(Number(val))) throw err_('INPUT', k + ' ต้องเป็นตัวเลข');
    if (String(cfg_(k)) !== val) { setCfg_(k, val); changed.push(k + '=' + val); }
  });
  if (changed.length) { bumpSummary_(); audit_(by_(u), 'settingsSave', changed.join(', ')); }
  return { changed: changed };
}
