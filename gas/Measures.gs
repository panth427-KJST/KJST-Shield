/********************************************************************
 * Measures.gs — มาตรการคู่การตัดคะแนน (ปรับเปลี่ยนพฤติกรรม / สัญญาพฤติกรรม / ทัณฑ์บน)
 *  ชีต Measures (System) : รายการมาตรการ ผู้ดูแลระบบแก้ได้ · keywords ใช้ติ๊กให้อัตโนมัติจากช่อง "แนวทาง" ของรายการคะแนน
 *  ชีต MeasureLog (DATA) : 1 แถว / นักเรียน / มาตรการ · ผูกกับ log_id ของ BehaviorLog (ยกเลิกคะแนน → ยกเลิกมาตรการ)
 *  มาตรการใช้ได้กับการ "หัก" คะแนนเท่านั้น · group เดียวกันเลือกได้ 1 ข้อ (เช่น ปรับเปลี่ยนพฤติกรรม 3/5/7 วัน)
 ********************************************************************/

var MEASURES_SEED = [
  // id, name, days, group, keywords, is_probation
  ['M03', 'ปรับเปลี่ยนพฤติกรรม 3 วัน', 3, 'ปรับเปลี่ยนพฤติกรรม', 'ปรับเปลี่ยนพฤติกรรม 3 วัน', false],
  ['M05', 'ปรับเปลี่ยนพฤติกรรม 5 วัน', 5, 'ปรับเปลี่ยนพฤติกรรม', 'ปรับเปลี่ยนพฤติกรรม 5 วัน', false],
  ['M07', 'ปรับเปลี่ยนพฤติกรรม 7 วัน', 7, 'ปรับเปลี่ยนพฤติกรรม', 'ปรับเปลี่ยนพฤติกรรม 7 วัน', false],
  ['MCT', 'ทำบันทึกสัญญาพฤติกรรม', 0, '', 'สัญญาพฤติกรรม', false],
  ['MPB', 'ทำทัณฑ์บน', 0, '', 'ทัณฑ์บน', true]
];

function measures_(includeInactive) {
  var rows = rows_('Measures');
  if (!rows.length) {
    append_('Measures', MEASURES_SEED.map(function (m, i) {
      return { measure_id: m[0], name: m[1], days: m[2], group: m[3], keywords: m[4], is_probation: m[5] ? 'TRUE' : 'FALSE', active: 'TRUE', sort_order: i + 1 };
    }));
    rows = rows_('Measures');
  }
  return rows.filter(function (r) { return r.measure_id && (includeInactive || bool_(r.active)); }).map(function (r) {
    return { id: r.measure_id, name: r.name, days: num_(r.days), group: r.group || '', keywords: splitList_(r.keywords),
             probation: bool_(r.is_probation), sort: num_(r.sort_order, 99) };
  }).sort(function (a, b) { return a.sort - b.sort; });
}

/** มาตรการที่ติ๊กให้อัตโนมัติจากข้อความแนวทางของรายการคะแนน (1 ข้อต่อ group) */
function suggestMeasures_(guidance, list) {
  var g = String(guidance || ''), out = [], groups = {};
  (list || measures_()).forEach(function (m) {
    if (!m.keywords.some(function (k) { return k && g.indexOf(k) >= 0; })) return;
    if (m.group && groups[m.group]) return;
    if (m.group) groups[m.group] = 1;
    out.push(m.id);
  });
  return out;
}

/** ตรวจรายการมาตรการที่เลือก → [{id,name,days,probation}] */
function pickMeasures_(ids, itemType) {
  ids = uniq_([].concat(ids || []).map(String).filter(Boolean));
  if (!ids.length) return [];
  if (itemType !== 'หัก') throw err_('INPUT', 'มาตรการเพิ่มเติมใช้ได้กับการหักคะแนนเท่านั้น');
  var all = {}; measures_().forEach(function (m) { all[m.id] = m; });
  var groups = {};
  return ids.map(function (id) {
    var m = all[id];
    if (!m) throw err_('INPUT', 'ไม่พบมาตรการ ' + id);
    if (m.group) { if (groups[m.group]) throw err_('INPUT', 'เลือก "' + m.group + '" ได้เพียง 1 ข้อ'); groups[m.group] = 1; }
    return m;
  });
}

/** วันเรียนถัดไป n วัน (ข้ามเสาร์-อาทิตย์) นับวันเริ่มเป็นวันที่ 1 */
function addSchoolDays_(iso, n) {
  var d = new Date(iso + 'T00:00:00'), left = Math.max(1, n) - 1;
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  var start = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; }
  return { start: start, end: Utilities.formatDate(d, TZ, 'yyyy-MM-dd') };
}

/** สร้างแถว MeasureLog ของรายการคะแนนที่บันทึก */
function measureRows_(logs, ms, by, stamp) {
  var out = [];
  logs.forEach(function (b) {
    ms.forEach(function (m) {
      var r = m.days ? addSchoolDays_(b.date, m.days) : { start: b.date, end: '' };
      out.push({ ml_id: b.log_id + '_' + m.id, log_id: b.log_id, student_id: b.student_id, grade: b.grade, room: b.room, year: b.year, term: b.term,
                 date: b.date, measure_id: m.id, name: m.name, days: m.days, probation: m.probation ? 'TRUE' : 'FALSE',
                 start_date: r.start, end_date: r.end, status: 'active', recorded_by: by, recorded_at: stamp, doc_no: '' });
    });
  });
  return out;
}

/** มาตรการรายคน (ปีการศึกษานี้ ไม่นับที่ยกเลิก) → { id: {list[], current[], probation, contract} } */
function measuresByStudent_(year, today) {
  var out = {};
  rows_('MeasureLog').forEach(function (m) {
    if (m.status === 'void' || m.year !== year) return;
    var x = out[m.student_id] = out[m.student_id] || { list: [], current: [], probation: 0, contract: 0 };
    var o = { name: m.name, date: m.date, start: m.start_date, end: m.end_date, days: num_(m.days), probation: bool_(m.probation), log_id: m.log_id };
    o.inProgress = !!(o.end && o.start <= today && today <= o.end);
    o.upcoming = !!(o.end && today < o.start);
    x.list.push(o);
    if (o.inProgress || o.upcoming) x.current.push(o);
    if (o.probation) x.probation++;
    if (/สัญญา/.test(m.name)) x.contract++;
  });
  return out;
}
