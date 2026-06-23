/**
 * thai-chat.ts
 * Agent conversation system in Thai language for Suwoith VOAI
 * Each agent has unique personality with gendered speech particles
 */

export interface ThaiChatMessage {
  sender: string      // Agent name
  role: string        // Agent role ID
  text: string        // Thai message
  type: 'greeting' | 'work' | 'break' | 'complete' | 'random' | 'response'
}

// Agent personalities with Thai speech styles
const AGENT_PERSONALITIES: Record<string, {
  name: string
  gender: 'male' | 'female'
  particle: string    // ครับ/ค่ะ/ครับผม
  style: string      // Brief description
}> = {
  hermes: { name: 'เฮอร์เมส', gender: 'male', particle: 'ครับ', style: 'มั่นใจ เป็นผู้นำ' },
  leo:    { name: 'ลีโอ', gender: 'male', particle: 'ครับ', style: ' analytic ละเอียด' },
  sam:    { name: 'แซม', gender: 'female', particle: 'ค่ะ', style: 'สร้างสรรค์ เป็นกันเอง' },
  ava:    { name: 'อวา', gender: 'female', particle: 'ค่ะ', style: 'ศิลปิน ละเอียดอ่อน' },
  bella:  { name: 'เบลล่า', gender: 'female', particle: 'ค่ะ', style: 'สังคม ร่าเริง' },
  sysbot: { name: 'ซิสบอท', gender: 'male', particle: 'ครับ', style: 'เทคนิค ตรงไปตรงมา' },
}

// Thai message templates by type
const THAI_MESSAGES: Record<string, string[]> = {
  greeting: [
    'สวัสดีตอนเช้าครับ วันนี้มีงานอะไรให้ทำบ้าง',
    'ยินดีต้อนรับเข้าสู่ออฟฟิศครับ',
    'อรุณสวัสดิ์ค่ะ วันนี้พร้อมทำงานแล้ว',
    'เช้านี้กาแฟอร่อยมากเลยค่ะ',
    'สวัสดีค่ะ วันนี้มีอะไรให้ช่วยไหมคะ',
    'ระบบทั้งหมดพร้อมทำงานครับ',
  ],
  work: [
    'กำลังประมวลผลข้อมูลอยู่ครับ',
    'เช็ครายงานเสร็จแล้วครับ ส่งให้เลยไหม',
    'กำลังเขียนเนื้อหาอยู่ค่ะ อีกแป๊บนึง',
    'ออกแบบ UI เสร็จแล้วค่ะ ขอรีวิวหน่อย',
    'โพสต์ลงโซเชียลแล้วค่ะ ยอดไลก์เริ่มมาแล้ว',
    'เซิร์ฟเวอร์ทำงานปกติครับ CPU ใช้ 30%',
    'กำลังวิเคราะห์แคมเปญโฆษณาอยู่ครับ',
    'เขียนเอกสาร API เสร็จแล้วค่ะ',
  ],
  break: [
    'ขอตัวไปกินกาแฟแป๊บนึงนะครับ',
    'พักสายตาหน่อยค่ะ จอคอมเมื่อย',
    'ไปเติมน้ำมาค่ะ',
    'ขอพัก 10 นาทีครับ',
    'ไปห้องน้ำแป๊บนึงค่ะ',
    'กินข้าวเที่ยงกันครับ',
  ],
  complete: [
    'เสร็จแล้วครับ! ส่งงานให้แล้ว',
    'งานเสร็จตามกำหนดค่ะ',
    'รีพอร์ตพร้อมแล้วครับ',
    'อัพโหลดไฟล์เสร็จแล้วค่ะ',
    'แคมเปญออนไลน์แล้วครับ',
    'ระบบอัพเดทเสร็จสมบูรณ์ครับ',
  ],
  response: [
    'ได้เลยครับ เดี๋ยวจัดการให้',
    'เข้าใจค่ะ ทำให้เลย',
    'ไม่มีปัญหาครับ',
    'รับทราบค่ะ',
    'จัดการให้เสร็จภายในวันนี้ครับ',
    'โอเคค่ะ รอแป๊บนึง',
    'เยี่ยมเลยครับ',
    'สุดยอดค่ะ!',
  ],
  random: [
    'วันนี้อากาศดีจังค่ะ',
    'เมื่อคืนนอนไม่ค่อยหลับครับ',
    'ใครเห็นแมวส้มหน้าออฟฟิศบ้างคะ',
    'สั่งข้าวกันไหมครับ',
    'วันนี้วันศุกร์แล้วค่ะ สู้ๆ',
    'ไฟล์นี้ใหญ่มาก เหมือนกับความฝันของฉันเลยค่ะ',
    'API ตอบสนองเร็วมากวันนี้ครับ',
    'ลูกค้าชอบงานชิ้นนี้มากค่ะ',
  ],
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function generateThaiChat(agentId: string, type: ThaiChatMessage['type'] = 'random'): ThaiChatMessage {
  const personality = AGENT_PERSONALITIES[agentId]
  if (!personality) {
    return { sender: agentId, role: agentId, text: '...', type }
  }

  const templates = THAI_MESSAGES[type] || THAI_MESSAGES.random
  let text = pick(templates)

  // Add personality particle if not present
  if (!text.includes('ครับ') && !text.includes('ค่ะ') && !text.includes('ครับผม')) {
    text = text + personality.particle
  }

  // Replace gendered particles for wrong gender
  if (personality.gender === 'female' && text.includes('ครับ') && !text.includes('ค่ะ')) {
    text = text.replace(/ครับ$/, 'ค่ะ')
  }
  if (personality.gender === 'male' && text.includes('ค่ะ')) {
    text = text.replace(/ค่ะ$/, 'ครับ')
  }

  return {
    sender: personality.name,
    role: agentId,
    text,
    type,
  }
}

// Generate a conversation between multiple agents
export function generateThaiConversation(agentIds: string[], turns: number = 5): ThaiChatMessage[] {
  const conversation: ThaiChatMessage[] = []
  const types: ThaiChatMessage['type'][] = ['greeting', 'work', 'response', 'work', 'complete']

  for (let i = 0; i < turns; i++) {
    const agentId = pick(agentIds)
    const type = types[i % types.length]
    conversation.push(generateThaiChat(agentId, type))
  }

  return conversation
}

// Office-appropriate Thai messages for specific contexts
export function getOfficeThaiMessage(context: 'morning' | 'lunch' | 'afternoon' | 'evening' | 'friday'): string[] {
  const messages: Record<string, string[]> = {
    morning: [
      'อรุณสวัสดิ์ค่ะ วันนี้มีงานอะไรให้ทำบ้าง',
      'เช้านี้รถติดมากเลยครับ',
      'กาแฟวันนี้อร่อยจังค่ะ',
      'สวัสดีตอนเช้าครับ พร้อมทำงานแล้ว',
    ],
    lunch: [
      'หิวข้าวแล้วค่ะ ไปกินข้าวด้วยกันไหม',
      'ข้าววันนี้มีอะไรกินครับ',
      'พักเที่ยงกันค่ะ',
      'สั่งข้าวออนไลน์ดีไหมครับ',
    ],
    afternoon: [
      'บ่ายนี้ง่วงจังค่ะ',
      'กาแฟอีกแก้วไหมครับ',
      'งานเสร็จครึ่งทางแล้วค่ะ',
      'สู้ๆ อีกนิดครับ',
    ],
    evening: [
      'วันนี้เหนื่อยมากค่ะ',
      'พรุ่งนี้เสาร์แล้วครับ',
      'เลิกงานกันไหมค่ะ',
      'วันนี้ทำงานเยอะมากครับ',
    ],
    friday: [
      'สุขสันต์วันศุกร์ค่ะ!',
      'วันนี้เลิกเร็วไหมครับ',
      'สุดสัปดาห์มีแพลนอะไรกันคะ',
      'ศุกร์แล้วครับ สู้ๆ',
    ],
  }

  return messages[context] || messages.morning
}
