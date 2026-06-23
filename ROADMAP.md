# ROADMAP — Virtual Office AI (Claude Agent Office)

> สถานะ ณ 2026-06-23 · Server `72.62.66.39:8443/office/` (Basic Auth user `admin`) · Repo `github.com/manbodyslam/claude-office` · Live service: `claude-office.service` (port 3336) หลัง proxy `voai-proxy-ssl.service` (8443).

วิธี deploy: แก้ source แล้วรัน `./deploy.sh` (build + restart + health check คำสั่งเดียว). frontend มี auto-reload — เปิดหน้าเว็บไว้ พอ deploy ใหม่จะ reload เองใน ~45 วิ.

---

## ✅ เสร็จแล้ว (ทดสอบจริง)
- แชทถาม-ตอบ + สั่งงาน (`@agent ทำ: ...`) + SysBot QA review — e2e ผ่าน
- เก็บประวัติแชท (SQLite `server/chat-db.js`) + replay history ตอนต่อ WS → reload แล้วแชทไม่หาย
- Auto-reload เมื่อมี build ใหม่ (ไม่ต้องกด F5)
- เต็มจอ + สเกลตัวละคร/เฟอร์นิเจอร์ตามสัดส่วน (transform scale + ResizeObserver)
- จุดสถานะการเชื่อมต่อจริง (เขียว=ต่อ, แดง=หลุด) + คำใบ้วิธีใช้ (welcome msg + placeholder)
- `deploy.sh` คำสั่งเดียว + git backup บน repo ตัวเอง + SSH deploy key บน server
- ปิด random coffee-break chatter, ช่องแชทกว้าง/อ่านง่าย

---

## ⏳ ที่เหลือ (เรียงตาม ผลกระทบ × ความเสี่ยง)

### P1 — คุณภาพ/ความน่าเชื่อถือ
1. **AI เร็วขึ้น + streaming** ⭐ (ปัญหาใหญ่สุด: ตอบช้า 5–60 วิ)
   - สาเหตุ: `/opt/voai/hermes-bridge.mjs` spawn `hermes chat` CLI ใหม่ทุกข้อความ (`--max-turns 1`)
   - แผน: เจาะ provider config ของ hermes (ollama-pay / kimi-k2.6) → เรียก API ตรง ไม่ spawn CLI + stream token ทยอยขึ้นจอ
   - แตะ: `hermes-bridge.mjs`, `ai-engine.mjs`, `simple-static.mjs`, frontend WS
   - แก้พ่วง: history ปนกันที่เคยเห็น (ข้อความหลงจาก context อื่น)
   - ⚠️ ต้องตัดสินใจ: OK ไหมที่จะเปลี่ยน path การเรียก AI (กระทบ messaging gateway ที่ใช้ร่วม)

2. **TLS จริง + โดเมน** (cert ตอนนี้ self-signed เบราว์เซอร์ขึ้น warning)
   - ต้องการ: **ชื่อโดเมน** ของเจ้าของ
   - แผน: ใช้ `nginx-proxy-manager` ที่รันอยู่แล้ว (80/443) + Let's Encrypt + โดเมน, ย้ายรหัส basic-auth ออกจาก `proxy-ssl.mjs` (ตอนนี้ plaintext)

3. **Error visibility + monitoring**
   - ตอนนี้หลายจุด `.catch(()=>{})` กลืน error เงียบ → โชว์บนจอเมื่อ backend/AI ล่ม
   - เพิ่ม monitor พอร์ต 3335/3336/3456 ใน uptime-kuma (มีรันอยู่แล้ว)

### P2 — ต่อยอดผลิตภัณฑ์
4. **ระบบงานจริงจัง** — task board ใน UI, persist task (มี postgres), QA fail แล้ววนแก้, ส่ง deliverable เป็นไฟล์จริง, agent เรียก tool จริง (เช็ค sandbox ก่อน)
5. **Multi-user / สิทธิ์ต่อคน** (ตอนนี้ auth เดียว hardcode)
6. **Mobile layout**
7. **รัน test** (มี `TEST_PLAN.md` แต่ยังไม่มีหลักฐานว่ารัน)

---

## ⚠️ หนี้/ความเสี่ยงที่ยังเหลือ
- รหัส basic-auth hardcode plaintext ใน `/opt/voai/proxy-ssl.mjs`
- `/opt/voai` มี dead code (ai-engine-v2, server.js, proxy-auth .js+.mjs) — ยังไม่ล้าง (คนละ repo, ไม่ใช่ git)
- AI ตอบช้า (ดู P1-1)

## วิธีกลับมาทำต่อ (resume)
เปิด Claude Code ที่เครื่อง พิมพ์: **"ทำต่อตาม ROADMAP — เริ่ม P1-x"**
context อยู่ครบใน repo นี้ + memory ของ assistant. แก้แล้ว deploy ด้วย `./deploy.sh` เสมอ.
