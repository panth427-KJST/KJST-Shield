/********************************************************************
 * KJST SHIELD v2 — ระบบดูแลช่วยเหลือนักเรียน
 * โรงเรียนกาญจนาภิเษกวิทยาลัย สุราษฎร์ธานี
 *
 * Config.gs — รหัสไฟล์ ค่าตั้งต้น และโครงสร้างชีตทั้งหมด
 * โปรเจกต์ Apps Script แบบ standalone (เจ้าของ panth427@kjst.ac.th)
 ********************************************************************/

var VERSION = '2.0.0';

/** รหัสไฟล์ (เปลี่ยนได้ใน Script Properties: SYSTEM_ID, DATA_ID, MASTER_ID, STUDENTS_ID) */
var IDS = {
  SYSTEM: '1CyT1E5gRTXJdQj0TPpBnoESuea74cQQmuULRNtK2uzE',   // KJST Shield System file
  DATA:   '1Hlx2Y0oeq4bQdvtICcNpJfJWJewzjfVdXT9yG0oOCss',   // KJST Shield database
  MASTER: '1dfdj6Mnd_Z7QA6Cf7gS1uK5rBSFO__MWMX4ikwjDhXU',   // Users กลาง (Staff_Master)
  STUDENTS: '18i5uknX6Ss1PLi5JqMRwdooi9Tewi9EbFJaHlMTEv3g'  // ฐานข้อมูลนักเรียนกลาง (ทะเบียนนักเรียน, ครูที่ปรึกษา)
};

var TZ = 'Asia/Bangkok';

/** ค่าตั้งต้นของชีต Config (setup จะเติมเฉพาะ key ที่ยังไม่มี) */
var CONFIG_DEFAULTS = [
  ['YEAR', '2569', 'ปีการศึกษาปัจจุบัน'],
  ['TERM', '2', 'ภาคเรียนปัจจุบัน'],
  ['SCHOOL_NAME', 'โรงเรียนกาญจนาภิเษกวิทยาลัย สุราษฎร์ธานี', ''],
  ['SCHOOL_DOMAIN', 'kjst.ac.th', 'โดเมนบัญชี Google ที่อนุญาต'],
  ['GOOGLE_CLIENT_ID', '387152732131-gfk59erhm4uivcmi026n6qdnnr48uufd.apps.googleusercontent.com', 'OAuth Client ID (ใช้ร่วมกับ E-Attendance ได้ถ้าโดเมนหน้าเว็บเดียวกัน)'],
  ['BASE_SCORE', '100', 'คะแนนตั้งต้นของแต่ละช่วงชั้น'],
  ['RISK_CRITICAL', '30', 'คะแนนต่ำกว่านี้ = วิกฤต'],
  ['RISK_HIGH', '50', 'คะแนนต่ำกว่านี้ = เสี่ยง'],
  ['RISK_WATCH', '60', 'คะแนนต่ำกว่านี้ = เฝ้าระวัง'],
  ['ATT_MIN', '80', 'มาเรียนต่ำกว่า % นี้ = เสี่ยง (เสี่ยงไม่มีสิทธิ์สอบ)'],
  ['ATT_NEAR', '85', 'มาเรียนต่ำกว่า % นี้ = เฝ้าระวัง'],
  ['MIN_DAYS', '5', 'ต้องมีข้อมูลเช็กชื่ออย่างน้อยกี่วันจึงประเมินเวลาเรียน'],
  ['ABSENT_WATCH', '3', 'ขาดเรียนสะสม (วัน) = เฝ้าระวัง'],
  ['LATE_WATCH', '5', 'มาสายสะสม (ครั้ง) = เฝ้าระวัง'],
  ['DRESS_WATCH', '3', 'ผิดระเบียบแต่งกาย/ทรงผมสะสม (ครั้ง) = เฝ้าระวัง'],
  ['SESSION_HOURS', '6', 'อายุ session (ชั่วโมง สูงสุด 6)'],
  ['ATT_WEB_URL', 'https://panth427-kjst.github.io/KJST-Attendance/', 'ลิงก์หน้าเว็บ KJST e-Attendance (ปุ่มบันทึกการมาเรียน/ตรวจระเบียบ ในหน้าชั้นเรียนของฉัน)'],
  ['YEARS', '2567,2568,2569', 'ปีการศึกษาที่แสดงในข้อมูลย้อนหลัง']
];

/**
 * โครงสร้างชีต: file = SYSTEM | DATA, cols = หัวคอลัมน์ (ระบบอ่านตามชื่อ ไม่ใช่ตามตำแหน่ง)
 * gold = คอลัมน์ที่ผู้ดูแลระบบกำหนดเอง (ระบายหัวสีทอง), ที่เหลือหัวสีน้ำเงิน
 */
var SCHEMA = {
  // ---------- System file ----------
  Config: { file: 'SYSTEM', cols: ['key', 'value', 'note'] },
  Users_Shield: {
    file: 'SYSTEM',
    cols: ['staff_id', 'email', 'display_name', 'staff_type', 'position', 'department', 'master_active', 'synced_at',
           'shield_role', 'grade_scope', 'room_scope', 'shield_active', 'assigned_by', 'assigned_at', 'last_login', 'note'],
    gold: ['shield_role', 'grade_scope', 'room_scope', 'shield_active', 'assigned_by', 'assigned_at', 'last_login', 'note']
  },
  Permissions: { file: 'SYSTEM', cols: ['action', 'label', 'executive', 'head', 'advisor', 'score_admin', 'sysadmin'] },
  ScoreItems: { file: 'SYSTEM', cols: ['item_id', 'type', 'category', 'item_name', 'points', 'guidance', 'is_severe', 'active', 'sort_order', 'updated_by', 'updated_at'] },
  CertRules: { file: 'SYSTEM', cols: ['min_score', 'max_score', 'label', 'issue_cert', 'sort_order'] },
  RulesLog: { file: 'SYSTEM', cols: ['at', 'by', 'table', 'key', 'field', 'old_value', 'new_value'] },
  AttendanceSources: { file: 'SYSTEM', cols: ['year', 'term', 'file_id', 'label', 'active', 'last_pull', 'last_result'] },
  ShieldKPI: { file: 'SYSTEM', cols: ['year', 'code', 'component', 'indicator', 'target', 'actual'] },
  AuditLog: { file: 'SYSTEM', cols: ['at', 'by', 'action', 'detail'] },

  // ---------- database ----------
  // ซิงก์จากฐานข้อมูลนักเรียนกลาง (ทะเบียนนักเรียน) + ข้อมูลเสริมจาก DMC (เบอร์ผู้ปกครอง, รหัสเข้าระบบนักเรียน)
  Students: {
    file: 'DATA',
    cols: ['student_id', 'number', 'prefix', 'first_name', 'last_name', 'gender', 'grade', 'room', 'status', 'status_date',
           'guardian_name', 'guardian_relation', 'synced_at', 'parent_phone', 'nid_last4', 'auth_hash', 'dmc_at'],
    gold: ['parent_phone', 'nid_last4', 'auth_hash', 'dmc_at']
  },
  BehaviorLog: {
    file: 'DATA',
    cols: ['log_id', 'date', 'year', 'term', 'student_id', 'grade', 'room', 'stage', 'item_id', 'type', 'category', 'item_name', 'points', 'severe',
           'note', 'recorded_by', 'recorded_at', 'status', 'void_by', 'void_at', 'void_reason']
  },
  AttendanceStats: { file: 'DATA', cols: ['year', 'term', 'student_id', 'present', 'official', 'leave', 'late', 'absent', 'days', 'dress', 'updated_at'] },
  AttendanceDaily: { file: 'DATA', cols: ['date', 'student_id', 'grade', 'room', 'status', 'dress_items'] },
  AttendanceRoomDaily: { file: 'DATA', cols: ['year', 'term', 'date', 'grade', 'room', 'total', 'present', 'official', 'leave', 'late', 'absent', 'blank'] },
  DressChecks: { file: 'DATA', cols: ['year', 'term', 'date', 'student_id', 'grade', 'room', 'items', 'note', 'recorded_by'] },
  CareLogs: { file: 'DATA', cols: ['care_id', 'date', 'student_id', 'grade', 'room', 'kind', 'detail', 'referred_to', 'status', 'recorded_by', 'recorded_at', 'updated_by', 'updated_at'] },
  StudentHistory: { file: 'DATA', cols: ['year', 'student_id', 'name', 'grade', 'room', 'status'] }
};

/** บทบาทและชื่อภาษาไทย */
var ROLES = ['executive', 'head', 'advisor', 'score_admin', 'sysadmin'];
var ROLE_TH = {
  executive: 'ผู้บริหาร', head: 'หัวหน้าระดับ', advisor: 'ครูที่ปรึกษา',
  score_admin: 'แอดมินบันทึกคะแนน', sysadmin: 'ผู้ดูแลระบบ', student: 'นักเรียน/ผู้ปกครอง'
};

/** ตารางสิทธิ์ตั้งต้น: action, label, executive, head, advisor, score_admin, sysadmin */
var PERMISSIONS_SEED = [
  ['dashboard.view',  'ดูแดชบอร์ด',                               1, 1, 1, 1, 1],
  ['student.view',    'ดูข้อมูลนักเรียนรายคน',                     1, 1, 1, 1, 1],
  ['student.contact', 'เห็นชื่อและเบอร์ผู้ปกครอง',                   1, 1, 1, 0, 1],
  ['care.record',     'บันทึกติดตาม เยี่ยมบ้าน ส่งต่อ',              0, 1, 1, 0, 0],
  ['score.record',    'บันทึกเพิ่ม/หักคะแนน',                       0, 0, 0, 1, 1],
  ['score.void',      'ยกเลิกรายการคะแนน',                         0, 0, 0, 1, 1],
  ['rules.edit',      'ปรับรายการคะแนนและเกณฑ์ใบรับรอง',            0, 0, 0, 0, 1],
  ['users.manage',    'ซิงก์และกำหนดบทบาทผู้ใช้',                    0, 0, 0, 0, 1],
  ['data.import',     'นำเข้า DMC / ดึงข้อมูลเช็กชื่อ / ยอดยกมา',      0, 0, 0, 0, 1],
  ['settings.manage', 'ตั้งค่าปีการศึกษา ภาคเรียน เกณฑ์เฝ้าระวัง',      0, 0, 0, 0, 1],
  ['shield.edit',     'บันทึกผลตัวชี้วัด KJST SHIELD',                 0, 0, 0, 0, 1]
];

/** รายการคะแนนตั้งต้น: id, type, category, name, points, guidance, severe */
var SCORE_ITEMS_SEED = [
  ['D01', 'หัก', 'เวลาเรียน', 'มาสาย', 5, 'กิจกรรม "มาเช้า ได้ดาว" · โทรแจ้งผู้ปกครอง · ตรวจสอบปัญหาการเดินทาง', false],
  ['D02', 'หัก', 'การแต่งกาย', 'แต่งกายผิดระเบียบ', 5, 'ตรวจหน้าเสาธง · ชี้แจงผู้ปกครอง · กองทุนชุดนักเรียน', false],
  ['D03', 'หัก', 'การแต่งกาย', 'ทรงผมผิดระเบียบ', 5, 'ตรวจทรงผมรายสัปดาห์ · แจ้งผู้ปกครอง', false],
  ['D04', 'หัก', 'วินัยในห้องเรียน', 'ใช้โทรศัพท์ในเวลาเรียน', 5, 'ข้อตกลงห้องเรียน', false],
  ['D05', 'หัก', 'เวลาเรียน', 'ขาดเรียนโดยไม่แจ้ง', 10, 'เยี่ยมบ้าน · ระบบเพื่อนช่วยเพื่อน · YC เพื่อนที่ปรึกษา · ส่งต่อครูแนะแนว', false],
  ['D06', 'หัก', 'เวลาเรียน', 'หนีเรียน', 10, 'ติดตามรายคาบ · สัญญาพฤติกรรม · ประชุมผู้ปกครอง', false],
  ['D07', 'หัก', 'เวลาเรียน', 'ออกนอกบริเวณโรงเรียน', 10, 'ติดตามรายคาบ · สัญญาพฤติกรรม · ประชุมผู้ปกครอง', false],
  ['D08', 'หัก', 'มารยาท', 'ไม่เคารพครู', 10, 'กิจกรรมพัฒนาคุณธรรม · ให้คำปรึกษารายบุคคล', false],
  ['D09', 'หัก', 'มารยาท', 'วาจาไม่สุภาพ', 10, 'กิจกรรมพัฒนาคุณธรรม · ให้คำปรึกษารายบุคคล', false],
  ['D10', 'หัก', 'พฤติกรรมร้ายแรง', 'ทะเลาะวิวาท', 30, 'ไกล่เกลี่ย · กิจกรรมจัดการอารมณ์ · ส่งต่อครูแนะแนว · เชิญผู้ปกครอง', true],
  ['D11', 'หัก', 'พฤติกรรมร้ายแรง', 'การพนัน', 30, 'ให้คำปรึกษารายบุคคล · เชิญผู้ปกครอง · ส่งต่อครูแนะแนว', true],
  ['D12', 'หัก', 'พฤติกรรมร้ายแรง', 'สูบบุหรี่', 30, 'คัดกรองสารเสพติด · ส่งต่อ รพ.สต./คลินิกเลิกบุหรี่ · เชิญผู้ปกครอง', true],
  ['D13', 'หัก', 'พฤติกรรมร้ายแรง', 'บุหรี่ไฟฟ้า', 30, 'คัดกรองสารเสพติด · ส่งต่อ รพ.สต./คลินิกเลิกบุหรี่ · เชิญผู้ปกครอง', true],
  ['D14', 'หัก', 'พฤติกรรมร้ายแรง', 'สารเสพติด', 30, 'คัดกรองสารเสพติด · ส่งต่อ รพ.สต. · เชิญผู้ปกครอง', true],
  ['P01', 'เพิ่ม', 'ความดี', 'จิตอาสา', 5, 'บันทึกความดี', false],
  ['P02', 'เพิ่ม', 'ความดี', 'บำเพ็ญประโยชน์', 5, 'บันทึกความดี', false],
  ['P03', 'เพิ่ม', 'ความดี', 'ช่วยเหลืองานโรงเรียน', 5, 'บันทึกความดี', false],
  ['P04', 'เพิ่ม', 'ความดี', 'เก็บของได้ส่งคืน', 5, 'ประกาศยกย่องหน้าเสาธง', false],
  ['P05', 'เพิ่ม', 'ความดี', 'เป็นแบบอย่างที่ดี', 5, 'สะสมเกียรติบัตร', false],
  ['P06', 'เพิ่ม', 'ผลงาน', 'ได้รับรางวัล', 10, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P07', 'เพิ่ม', 'ผลงาน', 'เป็นตัวแทนโรงเรียน', 10, 'บันทึกผลงาน', false],
  ['P08', 'เพิ่ม', 'รางวัลระดับจังหวัด', 'เกียรติบัตร ลำดับที่ 1-3 ระดับจังหวัด', 10, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P09', 'เพิ่ม', 'รางวัลระดับจังหวัด', 'โล่รางวัล ลำดับที่ 1-3 ระดับจังหวัด', 10, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P10', 'เพิ่ม', 'รางวัลระดับจังหวัด', 'เหรียญรางวัล ลำดับที่ 1-3 ระดับจังหวัด', 10, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P11', 'เพิ่ม', 'รางวัลระดับประเทศ', 'เกียรติบัตร ลำดับที่ 1-3 ระดับประเทศ', 15, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P12', 'เพิ่ม', 'รางวัลระดับประเทศ', 'โล่รางวัล ลำดับที่ 1-3 ระดับประเทศ', 15, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P13', 'เพิ่ม', 'รางวัลระดับประเทศ', 'เหรียญรางวัล ลำดับที่ 1-3 ระดับประเทศ', 15, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P14', 'เพิ่ม', 'รางวัลระดับนานาชาติ', 'เกียรติบัตร ลำดับที่ 1-3 ระดับนานาชาติ', 20, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P15', 'เพิ่ม', 'รางวัลระดับนานาชาติ', 'โล่รางวัล ลำดับที่ 1-3 ระดับนานาชาติ', 20, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false],
  ['P16', 'เพิ่ม', 'รางวัลระดับนานาชาติ', 'เหรียญรางวัล ลำดับที่ 1-3 ระดับนานาชาติ', 20, 'บันทึกผลงาน · ประกาศยกย่องหน้าเสาธง', false]
];

/** เกณฑ์ใบรับรองความประพฤติ: min, max (ว่าง = ไม่จำกัด), label, issue_cert */
var CERT_RULES_SEED = [
  [101, '', 'เรียบร้อยดีมาก', true],
  [70, 100, 'เรียบร้อย', true],
  [50, 69, 'พอใช้', true],
  [30, 49, 'ควรปรับปรุง', true],
  ['', 29, 'ไม่ออกหนังสือรับรองความประพฤติ', false]
];

/** ตัวชี้วัด KJST SHIELD — actual ขึ้นต้น AUTO_ = ระบบคำนวณเอง */
var SHIELD_SEED = [
  ['S', 'Strategic Screening', 'นักเรียนกลุ่มปกติจากการคัดกรอง (%)', 90, 'AUTO_NORMAL'],
  ['S', 'Strategic Screening', 'คัดกรองรายบุคคล/เยี่ยมบ้านครบ (%)', 100, '0'],
  ['H', 'Holistic Development', 'นักเรียนมีผลความประพฤติระดับเรียบร้อยขึ้นไป (%)', 95, 'AUTO_GOOD'],
  ['H', 'Holistic Development', 'กิจกรรมพัฒนาคุณธรรม/สุขภาวะ (กิจกรรม)', 10, '0'],
  ['I', 'Integrated Curriculum & Information', 'อัตราการมาเรียนเฉลี่ย (%)', 95, 'AUTO_ATT'],
  ['I', 'Integrated Curriculum & Information', 'ความครบถ้วนการเช็กชื่อผ่านระบบ (%)', 100, 'AUTO_RECORD'],
  ['E', 'Empowering Teachers', 'ครูเข้าร่วม PLC (%)', 100, '0'],
  ['E', 'Empowering Teachers', 'Coaching & Mentoring (ครั้ง)', 12, '0'],
  ['L', 'Leadership & Linkage', 'ผู้ปกครองเข้าร่วมประชุม/กิจกรรม (%)', 80, '0'],
  ['L', 'Leadership & Linkage', 'ภาคีเครือข่ายชุมชน (หน่วยงาน)', 5, '0'],
  ['D', 'Data-driven Development', 'รายงานวิเคราะห์ข้อมูลรายภาค (ฉบับ)', 2, '0'],
  ['D', 'Data-driven Development', 'โครงการปรับปรุงจากผลข้อมูล (โครงการ)', 3, '0']
];

/** แหล่งข้อมูลเช็กชื่อตั้งต้น */
var ATTENDANCE_SOURCES_SEED = [
  ['2569', '2', '1KFVE1AenbfaRiAWxRefoU9xIR8b0fKgMZ4RReMnruhw', 'E-Attendance 2-2569', true]
];

/** ผู้ดูแลระบบตั้งต้น */
var SEED_SYSADMINS = ['T003', 'T304'];

/** สถานะการมาเรียนใน E-Attendance (ตัวเลขนำหน้า) */
var ATT_CODES = { '1': 'มา', '2': 'ราชการ', '3': 'ลา', '4': 'สาย', '5': 'ขาด' };

/** นักเรียนปัจจุบัน = สถานะ "กำลังศึกษา" ในทะเบียนนักเรียน (รอย้าย/ย้ายออก/จำหน่าย ไม่นับ) */
var ACTIVE_STATUS = 'กำลังศึกษา';

var CARE_KINDS = ['ติดตาม', 'เยี่ยมบ้าน', 'ส่งต่อ'];
var CARE_STATUS = ['ดำเนินการ', 'เสร็จสิ้น'];
var LEVELS = ['ปกติ', 'เฝ้าระวัง', 'เสี่ยง', 'วิกฤต'];
