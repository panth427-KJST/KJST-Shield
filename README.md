# KJST Shield v2 — ระบบดูแลช่วยเหลือนักเรียน

โรงเรียนกาญจนาภิเษกวิทยาลัย สุราษฎร์ธานี · กลุ่มบริหารงานกิจการนักเรียน

| โฟลเดอร์ | เนื้อหา |
|---|---|
| `report/` | รายงานการวิเคราะห์และออกแบบระบบ (เปิดผ่าน GitHub Pages: `/report/`) |
| `app/` | หน้าเว็บระบบ (HTML ไฟล์เดียว เรียก API ของ Apps Script) |
| `gas/` | โค้ด Google Apps Script (backend) |
| `assets/` | ตราโรงเรียน |
| `index.html` | หน้าเช็กชื่อ E-Attendance เดิม (ไม่ได้แก้ไข) |

## ไฟล์ข้อมูล

- **KJST Shield System file** `1CyT1E5gRTXJdQj0TPpBnoESuea74cQQmuULRNtK2uzE` — Config, Users_Shield, Permissions, ScoreItems, CertRules, RulesLog, AttendanceSources, ShieldKPI, AuditLog
- **KJST Shield database** `1Hlx2Y0oeq4bQdvtICcNpJfJWJewzjfVdXT9yG0oOCss` — Students, DMC, BehaviorLog, AttendanceStats, AttendanceDaily, CareLogs, StudentHistory
- **Users กลาง** `1dfdj6Mnd_Z7QA6Cf7gS1uK5rBSFO__MWMX4ikwjDhXU` (อ่านอย่างเดียว)
- **ฐานข้อมูลนักเรียนกลาง** `18i5uknX6Ss1PLi5JqMRwdooi9Tewi9EbFJaHlMTEv3g` — ชีต ทะเบียนนักเรียน, ครูที่ปรึกษา (อ่านอย่างเดียว)
- **E-Attendance 2-2569** `1KFVE1AenbfaRiAWxRefoU9xIR8b0fKgMZ4RReMnruhw` (อ่านอย่างเดียว)

## ติดตั้ง (บัญชี panth427@kjst.ac.th)

1. สร้างโปรเจกต์ Apps Script แบบ standalone แล้วคัดลอกทุกไฟล์ใน `gas/` (หรือ `clasp clone`/`clasp push` โดยตั้ง `"rootDir": "gas"` ใน `.clasp.json`)
2. ให้บัญชีเจ้าของสคริปต์มีสิทธิ์แก้ไข System file และ database และมีสิทธิ์อ่าน Users กลาง ฐานข้อมูลนักเรียนกลาง และ E-Attendance
3. รันตามลำดับใน editor และอนุญาตสิทธิ์:
   - `setup` — สร้างชีตทั้งหมด ใส่เกณฑ์ตั้งต้น และสร้าง pepper ใน Script Properties
   - `syncUsers` — ซิงก์ผู้บริหารและครูจาก Staff_Master
   - `syncStudents` — ซิงก์รายชื่อนักเรียนจากฐานข้อมูลนักเรียนกลาง (ชีต ทะเบียนนักเรียน)
   - `seedRoles` — ตั้งต้นบทบาท (ผู้บริหาร, ครูที่ปรึกษา/หัวหน้าระดับจากชีต ครูที่ปรึกษา, ผู้ดูแลระบบ T003 และ T304)
   - วางข้อมูล DMC ในชีต `DMC` ของไฟล์ database แล้วรัน `importDMC` (เพิ่มเบอร์ผู้ปกครองและรหัสเข้าระบบนักเรียน)
   - `pullAttendance` แล้ว `installTriggers` (ดึงข้อมูลเช็กชื่ออัตโนมัติ 08:30 และ 10:00)
   - `testSystem` — ตรวจผลใน Execution log
4. Deploy › New deployment › Web app · Execute as: **Me** · Who has access: **Anyone**
5. นำ URL ที่ลงท้าย `/exec` ไปใส่ `CONFIG.API_URL` ใน `app/index.html`
6. ตรวจว่า OAuth Client ID (Config: `GOOGLE_CLIENT_ID`) มี Authorized JavaScript origin เป็น `https://panth427-kjst.github.io`

## หมายเหตุด้านความปลอดภัย

- รหัสผ่านบุคลากรตรวจกับ `password_hash`/`salt` ใน Staff_Master ด้วย PBKDF2-HMAC-SHA256 500 รอบ (สูตรเดียวกับ e-Score) — Shield อ่านอย่างเดียว
- นักเรียน/ผู้ปกครองเข้าด้วยเลขบัตรประชาชน + วันเกิด ระบบเก็บเฉพาะ HMAC-SHA256 (pepper ใน Script Properties) และเลข 4 ตัวท้าย
- ล็อก 15 นาทีเมื่อกรอกผิด 5 ครั้ง · session อยู่ใน CacheService 6 ชั่วโมง
- คะแนนที่บันทึกแล้วยกเลิกได้ (ต้องมีเหตุผล) แต่ลบไม่ได้ · การปรับเกณฑ์ทุกครั้งบันทึกใน RulesLog
