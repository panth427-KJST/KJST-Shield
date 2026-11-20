/********************************************************************
 * Attendance.gs — ดึงข้อมูลจาก KJST E-Attendance (อ่านอย่างเดียว)
 *  ไฟล์ละ 1 ภาคเรียน · ชีตห้อง "ม.X/Y" · แถว = นักเรียน · คอลัมน์ = วันที่ ("พุธ 28 ต.ค. 26")
 *  สถานะ: 1 มาโรงเรียน, 2 ไปราชการ/อื่นๆ (นับเป็นมา), 3 ลาป่วย/ลากิจ, 4 มาสาย, 5 ขาดเรียน
 *  ผลตรวจการแต่งกาย (ถ้ามี): ชีต "_ตรวจระเบียบ" คอลัมน์ date, student_id, room, items, note, recorded_by, status
 *    (บันทึกเฉพาะคนที่ผิดระเบียบ · status = void ไม่นับ) → เก็บใน DressChecks สำหรับแดชบอร์ด
 ********************************************************************/

var TH_MONTHS = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12 };

/** "พุธ 28 ต.ค. 26" → "2026-10-28" (ปีเป็น ค.ศ. 2 หลัก; ถ้าเป็น พ.ศ. 2 หลัก (>=60) แปลงให้) */
function parseThaiDateLabel_(label) {
  var m = String(label || '').match(/(\d{1,2})\s*([ก-๙]{1,4}\.[ก-๙]{0,2}\.?)\s*(\d{2,4})/);
  if (!m) return '';
  var mon = TH_MONTHS[m[2].replace(/\s/g, '')] || TH_MONTHS[m[2].replace(/\.?$/, '.')];
  if (!mon) return '';
  var y = Number(m[3]);
  if (y < 100) y = y >= 60 ? 2500 + y - 543 : 2000 + y;
  else if (y > 2400) y -= 543;
  return y + '-' + ('0' + mon).slice(-2) + '-' + ('0' + Number(m[1])).slice(-2);
}

function attSources_(onlyActive) {
  return rows_('AttendanceSources').filter(function (s) { return s.file_id && (!onlyActive || bool_(s.active)); });
}

/** ดึงข้อมูลทุกแหล่งของปีการศึกษาปัจจุบัน → AttendanceStats + AttendanceDaily */
function pullAttendance_(by) {
  var y = year_(), today = today_(), keepFrom = '';   // เก็บรายวันครบทั้งปีการศึกษา (ใช้ดูย้อนหลังในหน้าชั้นเรียนของฉัน)
  var sources = attSources_(true).filter(function (s) { return s.year === y; });
  if (!sources.length) throw err_('INPUT', 'ยังไม่ได้ตั้งค่าไฟล์ E-Attendance ของปีการศึกษา ' + y);
  var stats = [], daily = [], dress = [], roomDaily = [], results = [], stamp = now_(), todayRooms = {}, roomsTotal = 0;

  sources.forEach(function (src) {
    var r = { year: src.year, term: src.term, rooms: 0, students: 0, days: 0, coverage: 0, error: '' };
    try {
      var ss = SpreadsheetApp.openById(src.file_id), per = {}, covSum = 0, covN = 0, maxDays = 0;
      ss.getSheets().forEach(function (sh) {
        var nm = sh.getName(), mm = nm.match(/^ม\.(\d)\/(\d+)$/);
        if (!mm) return;
        var grade = 'ม.' + mm[1], room = String(Number(mm[2]));
        var v = sh.getDataRange().getDisplayValues();
        if (v.length < 2) return;
        var head = v[0], cols = [];
        for (var c = 3; c < head.length; c++) {
          var iso = parseThaiDateLabel_(head[c]);
          if (iso && iso <= today) cols.push({ c: c, iso: iso });
        }
        r.rooms++;
        var dayCnt = {};   // iso → { present, official, leave, late, absent, coded }
        cols.forEach(function (col) { dayCnt[col.iso] = { present: 0, official: 0, leave: 0, late: 0, absent: 0, coded: 0 }; });
        var nStu = 0;
        if (src.term === term_()) roomsTotal++;
        var recorded = {};
        for (var i = 1; i < v.length; i++) {
          if (!/^\d+$/.test(String(v[i][0]).trim())) continue;
          var id = sid_(v[i][1]); if (!id) continue;
          nStu++;
          var x = per[id] = per[id] || { present: 0, official: 0, leave: 0, late: 0, absent: 0, dress: 0, grade: grade, room: room };
          cols.forEach(function (col) {
            var code = String(v[i][col.c] || '').trim().charAt(0);
            if (!ATT_CODES[code]) return;
            recorded[col.iso] = 1;
            var dc = dayCnt[col.iso]; dc.coded++;
            dc[{ '1': 'present', '2': 'official', '3': 'leave', '4': 'late', '5': 'absent' }[code]]++;
            if (code === '1') x.present++; else if (code === '2') x.official++; else if (code === '3') x.leave++;
            else if (code === '4') x.late++; else if (code === '5') x.absent++;
            if (code !== '1' && col.iso >= keepFrom) daily.push({ date: col.iso, student_id: id, grade: grade, room: room, status: ATT_CODES[code], dress_items: '' });
          });
        }
        Object.keys(dayCnt).forEach(function (iso) {
          var dc = dayCnt[iso]; if (!dc.coded) return;
          roomDaily.push({ year: src.year, term: src.term, date: iso, grade: grade, room: room, total: nStu, present: dc.present, official: dc.official,
                           leave: dc.leave, late: dc.late, absent: dc.absent, blank: Math.max(0, nStu - dc.coded) });
        });
        if (recorded[today] && src.term === term_()) todayRooms[cls_(grade, room)] = 1;
        var nRec = Object.keys(recorded).length;
        maxDays = Math.max(maxDays, nRec);
        covSum += cols.length ? nRec / cols.length : 0; covN++;
      });

      // ผลตรวจแต่งกาย/ทรงผม (ถ้ามีชีต)
      var dsh = ss.getSheetByName('_ตรวจระเบียบ');
      if (dsh && dsh.getLastRow() > 1) {
        var dv = dsh.getDataRange().getValues(), dh = dv[0].map(function (x) { return String(x).trim(); });
        var col = function (n) { return dh.indexOf(n); };
        var di = { date: col('date'), sid: col('student_id'), items: col('items'), note: col('note'), by: col('recorded_by'), st: col('status') };
        if (di.date >= 0 && di.sid >= 0) {
          var seen = {};
          for (var k = 1; k < dv.length; k++) {
            if (di.st >= 0 && str_(dv[k][di.st]).toLowerCase() === 'void') continue;
            var dRaw = dv[k][di.date];
            var dd = dRaw instanceof Date ? Utilities.formatDate(dRaw, 'Asia/Bangkok', 'yyyy-MM-dd') : (normDate_(str_(dRaw)) || str_(dRaw));
            var did = sid_(dv[k][di.sid]);
            if (!did || !per[did] || !dd || dd > today) continue;
            var items = di.items >= 0 ? str_(dv[k][di.items]) : '';
            var rec = { year: src.year, term: src.term, date: dd, student_id: did, grade: per[did].grade, room: per[did].room, items: items,
                        note: di.note >= 0 ? str_(dv[k][di.note]) : '', recorded_by: di.by >= 0 ? str_(dv[k][di.by]) : '' };
            var sk = dd + '|' + did;
            if (seen[sk] !== undefined) { dress[seen[sk]] = rec; continue; }   // 1 คน 1 แถวต่อวัน — แถวหลังทับแถวก่อน
            seen[sk] = dress.length; dress.push(rec);
            per[did].dress++;
            if (dd >= keepFrom) {
              var ex = daily.filter(function (d) { return d.date === dd && d.student_id === did; })[0];
              if (ex) ex.dress_items = items;
              else daily.push({ date: dd, student_id: did, grade: per[did].grade, room: per[did].room, status: 'มา', dress_items: items });
            }
          }
        }
      }

      Object.keys(per).forEach(function (id) {
        var x = per[id], days = x.present + x.official + x.leave + x.late + x.absent;
        stats.push({ year: src.year, term: src.term, student_id: id, present: x.present, official: x.official, leave: x.leave, late: x.late, absent: x.absent, days: days, dress: x.dress, updated_at: stamp });
      });
      r.students = Object.keys(per).length; r.days = maxDays; r.coverage = covN ? round1_(covSum / covN * 100) : 0;
    } catch (e) { r.error = e.message; }
    results.push(r);
  });

  lock_(function () {
    var keepStats = rows_('AttendanceStats').filter(function (s) {
      return !sources.some(function (src) { return src.year === s.year && src.term === s.term; }) ||
             results.some(function (rr) { return rr.error && rr.year === s.year && rr.term === s.term; });
    });
    writeAll_('AttendanceStats', keepStats.concat(stats));
    writeAll_('AttendanceDaily', daily.sort(function (a, b) { return b.date.localeCompare(a.date); }));
    var keepRD = rows_('AttendanceRoomDaily').filter(function (d) {
      return !sources.some(function (src) { return src.year === d.year && src.term === d.term; }) ||
             results.some(function (rr) { return rr.error && rr.year === d.year && rr.term === d.term; });
    });
    writeAll_('AttendanceRoomDaily', keepRD.concat(roomDaily).sort(function (a, b) { return b.date.localeCompare(a.date) || gnum_(a.grade) - gnum_(b.grade) || Number(a.room) - Number(b.room); }));
    var keepDress = rows_('DressChecks').filter(function (d) {
      return !sources.some(function (src) { return src.year === d.year && src.term === d.term; }) ||
             results.some(function (rr) { return rr.error && rr.year === d.year && rr.term === d.term; });
    });
    writeAll_('DressChecks', keepDress.concat(dress).sort(function (a, b) { return b.date.localeCompare(a.date); }));
    var srcRows = rows_('AttendanceSources');
    var upd = srcRows.filter(function (s) { return sources.some(function (x) { return x._row === s._row; }); }).map(function (s) {
      var rr = results.filter(function (x) { return x.year === s.year && x.term === s.term; })[0];
      return Object.assign({}, s, { last_pull: stamp, last_result: JSON.stringify(rr) });
    });
    updateRows_('AttendanceSources', upd);
    setCfg_('ATT_TODAY', JSON.stringify({ date: today, rooms: Object.keys(todayRooms), total: roomsTotal, at: stamp }));
  });
  bumpSummary_();
  try { pullRequests_(); } catch (e) { Logger.log('pullRequests: ' + e.message); }
  if (by) audit_(by, 'attendancePull', results);
  return results;
}

/** สำหรับ trigger อัตโนมัติ */
function pullAttendanceAuto() {
  try { pullAttendance_('ระบบอัตโนมัติ'); } catch (e) { Logger.log('pullAttendanceAuto: ' + e.message); }
}

function attendanceSourceSave_(by, p) {
  var y = String(p.year || '').replace(/\D/g, ''), t = String(p.term || '').replace(/\D/g, '');
  var fid = String(p.file_id || '').trim();
  var m = fid.match(/\/d\/([a-zA-Z0-9_-]{20,})/); if (m) fid = m[1];
  if (y.length !== 4 || ['1', '2'].indexOf(t) < 0 || fid.length < 20) throw err_('INPUT', 'กรุณาระบุปีการศึกษา ภาคเรียน และลิงก์/รหัสไฟล์ E-Attendance ให้ถูกต้อง');
  try { SpreadsheetApp.openById(fid).getName(); } catch (e) { throw err_('INPUT', 'เปิดไฟล์นี้ไม่ได้ — แชร์ไฟล์ให้บัญชีเจ้าของสคริปต์ก่อน'); }
  var cur = rows_('AttendanceSources').filter(function (s) { return s.year === y && s.term === t; })[0];
  var o = { year: y, term: t, file_id: fid, label: p.label || ('E-Attendance ' + t + '-' + y), active: p.active === false ? 'FALSE' : 'TRUE' };
  lock_(function () { if (cur) updateRows_('AttendanceSources', [Object.assign({}, cur, o)]); else append_('AttendanceSources', [o]); });
  audit_(by, 'attendanceSourceSave', o);
  return true;
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'pullAttendanceAuto') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pullAttendanceAuto').timeBased().everyDays(1).atHour(8).nearMinute(30).create();
  ScriptApp.newTrigger('pullAttendanceAuto').timeBased().everyDays(1).atHour(10).nearMinute(0).create();
  Logger.log('ตั้งเวลาดึงข้อมูลเช็กชื่อวันละ 2 รอบ (08:30, 10:00) แล้ว');
}
