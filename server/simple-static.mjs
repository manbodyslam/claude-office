import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

// AI Engine
import { chatWithAgent, generateAgentConversation, executeTaskWithAI, parseChatCommand, getAgentInfo, qaReviewTask } from '/opt/voai/ai-engine.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = 3336
const STATIC_DIR = join(__dirname, '..', 'dist')
const VOAI_BACKEND = 'http://127.0.0.1:3335'
const DB_PATH = '/opt/voai/data/voai.db'

const app = express()
const server = createServer(app)
app.use(express.json())

// Map office agent id -> frontend AGENT_CONFIGS role (avatar/name/color)
const FRONTEND_ROLE = { hermes:'coordinator', leo:'analyst', sam:'writer', ava:'designer', bella:'social', sysbot:'ops' }

// ── Agent info for office ──
const OFFICE_AGENTS = {
  hermes: { name: 'เฮอร์เมส', color: '#5e6ad2', role: 'Coordinator', gender: 'male' },
  leo:    { name: 'ลีโอ', color: '#3b82f6', role: 'Analyst', gender: 'male' },
  sam:    { name: 'แซม', color: '#10b981', role: 'Writer', gender: 'female' },
  ava:    { name: 'อวา', color: '#f59e0b', role: 'Designer', gender: 'female' },
  bella:  { name: 'เบลล่า', color: '#ec4899', role: 'Social', gender: 'female' },
  sysbot: { name: 'ซิสบอท', color: '#6366f1', role: 'Ops', gender: 'male' },
}

// ── WebSocket clients ──
const wsClients = new Set()
const agentStatuses = {} // { agentId: 'idle'|'working'|'thinking' }

function wsBroadcast(data) {
  const json = JSON.stringify(data)
  wsClients.forEach(ws => { if (ws.readyState === 1) ws.send(json) })
}

// ── WebSocket server at /ws ──
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  wsClients.add(ws)
  console.log('[office-ws] Client connected. Total:', wsClients.size)

  // Send initial state
  ws.send(JSON.stringify({
    type: 'office_init',
    statuses: agentStatuses,
    agents: OFFICE_AGENTS
  }))

  // Snapshot in the protocol the React frontend understands -> agents appear in the room
  ws.send(JSON.stringify({
    type: 'snapshot',
    mcpServers: [],
    activeAgents: Object.entries(OFFICE_AGENTS).map(([id, a]) => ({
      id, name: a.name, role: FRONTEND_ROLE[id] || 'general-purpose', task: a.role
    }))
  }))

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString())
      console.log('[office-ws]', msg.type)

      switch (msg.type) {
        case 'office_init':
          // Already sent
          break

        case 'office_user_chat':
          await handleUserChat(ws, msg.text)
          break

        case 'office_command':
          await handleCommand(ws, msg.text)
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }))
          break
      }
    } catch (e) {
      console.error('[office-ws] Error:', e.message)
    }
  })

  ws.on('close', () => {
    wsClients.delete(ws)
    console.log('[office-ws] Client disconnected. Total:', wsClients.size)
  })
})

// ── Handle user chat with AI ──
async function handleUserChat(ws, text) {
  try {
    // Show user message first
    wsBroadcast({ type: 'office_user', text })

    // Determine target agent
    let cmd
    try {
      cmd = parseChatCommand(text)
    } catch {
      // Plain text without @agent → route to Hermes by default
      cmd = { agentId: 'hermes', message: text }
    }

    const agent = OFFICE_AGENTS[cmd.agentId]
    if (!agent) {
      wsBroadcast({ type: 'office_chat', agent: 'system', text: 'ไม่พบ agent นี้ ลอง @hermes @leo @sam @ava @bella @sysbot' })
      return
    }

    // Show thinking
    agentStatuses[cmd.agentId] = 'thinking'
    wsBroadcast({ type: 'office_status', agent: cmd.agentId, status: 'thinking' })
    wsBroadcast({ type: 'office_chat', agent: cmd.agentId, text: '...กำลังคิด...', thinking: true })

    // Call AI with fallback to mock replies on rate limit
    let reply
    try {
      reply = await chatWithAgent(cmd.agentId, cmd.message)
    } catch (aiErr) {
      console.error('[office] AI error, using fallback:', aiErr.message)
      const fallbacks = {
        hermes: 'สวัสดีครับ มีอะไรให้ช่วยประสานงานครับ?',
        leo: 'สวัสดีครับ วันนี้ต้องการวิเคราะห์อะไรครับ?',
        sam: 'สวัสดีค่ะ จะให้ช่วยเขียนอะไรคะ?',
        ava: 'สวัสดีค่ะ ต้องการออกแบบอะไรคะ?',
        bella: 'สวัสดีค่ะ จะโพสต์อะไรดีคะ?',
        sysbot: 'ระบบพร้อมทำงานครับ มีอะไรต้องตรวจสอบครับ?'
      }
      reply = fallbacks[cmd.agentId] || 'รับทราบครับ/ค่ะ กำลังดำเนินการให้'
    }

    // Remove thinking, show reply
    wsBroadcast({ type: 'office_chat', agent: cmd.agentId, text: reply, thinking: false })
    agentStatuses[cmd.agentId] = 'idle'
    wsBroadcast({ type: 'office_status', agent: cmd.agentId, status: 'idle' })

  } catch (e) {
    console.error('[office] chat error:', e.message)
    wsBroadcast({ type: 'office_chat', agent: 'system', text: 'AI ไม่ตอบ ลองใหม่อีกครั้ง' })
  }
}

// ── Handle task command from chat ──
async function handleCommand(ws, text) {
  try {
    const cmd = parseChatCommand(text)
    const agent = OFFICE_AGENTS[cmd.agentId]
    if (!agent) {
      wsBroadcast({ type: 'office_chat', agent: 'system', text: 'ไม่พบ agent' })
      return
    }

    // Show user's command
    wsBroadcast({ type: 'office_user', text })

    // Extract task title (after "ทำ:")
    const taskMatch = text.match(/^@(\w+)\s+ทำ:\s*(.+)/)
    const taskTitle = taskMatch ? taskMatch[2] : cmd.message

    // Create task via VOAI API
    const taskBody = {
      title: taskTitle,
      assignee: cmd.agentId,
      type: 'general',
      priority: 'medium',
      description: `สั่งจาก Office โดยบอส: ${cmd.message}`,
      data: {}
    }

    const resp = await fetch(`${VOAI_BACKEND}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody)
    })

    if (resp.ok) {
      const particle = agent.gender === 'male' ? 'ครับ' : 'ค่ะ'
      wsBroadcast({ type: 'office_chat', agent: cmd.agentId, text: `รับทราบ${particle}! จะทำ "${taskTitle}" ให้เลย${particle}` })
      agentStatuses[cmd.agentId] = 'working'
      wsBroadcast({ type: 'office_status', agent: cmd.agentId, status: 'working' })

      // Now actually execute the task with AI
      wsBroadcast({ type: 'office_chat', agent: cmd.agentId, text: 'เริ่มทำงานแล้ว...', thinking: false })
      
      const aiResult = await executeTaskWithAI({ title: taskTitle, assignee: cmd.agentId, description: cmd.message, type: 'general' })
      
      if (aiResult.success) {
        wsBroadcast({ type: 'office_chat', agent: cmd.agentId, text: aiResult.chatMessage, thinking: false })
        agentStatuses[cmd.agentId] = 'idle'
        wsBroadcast({ type: 'office_status', agent: cmd.agentId, status: 'idle' })

        // QA Review by SysBot
        agentStatuses['sysbot'] = 'qa'
        wsBroadcast({ type: 'office_status', agent: 'sysbot', status: 'qa' })
        wsBroadcast({ type: 'office_chat', agent: 'sysbot', text: `🔍 เริ่มตรวจสอบงาน "${taskTitle}"...`, thinking: false })
        
        const qaResult = await qaReviewTask({ title: taskTitle, assignee: cmd.agentId }, aiResult.rawResult || aiResult.chatMessage)
        
        const badge = qaResult.verdict === 'pass' ? ' ✅' : qaResult.verdict === 'fail' ? ' ❌' : ' ⚠️'
        wsBroadcast({ type: 'office_qa', agent: 'sysbot', text: qaResult.chatMessage, task_title: taskTitle, verdict: qaResult.verdict, badge })
        
        if (qaResult.verdict === 'fail') {
          wsBroadcast({ type: 'office_chat', agent: cmd.agentId, text: `รับทราบ จะแก้ไขงานใหม่`, thinking: false })
        }
        
        agentStatuses['sysbot'] = 'idle'
        wsBroadcast({ type: 'office_status', agent: 'sysbot', status: 'idle' })
      } else {
        wsBroadcast({ type: 'office_chat', agent: cmd.agentId, text: aiResult.chatMessage, thinking: false })
        agentStatuses[cmd.agentId] = 'idle'
        wsBroadcast({ type: 'office_status', agent: cmd.agentId, status: 'idle' })
      }
    } else {
      wsBroadcast({ type: 'office_chat', agent: 'system', text: 'สร้าง task ไม่สำเร็จ' })
    }
  } catch (e) {
    console.error('[office] command error:', e.message)
  }
}

// ── Auto agent-to-agent conversation (every 30-60s) ──
let conversationTimer = null

async function triggerAgentConversation() {
  try {
    const conv = await generateAgentConversation()
    if (conv) {
      const toAgent = OFFICE_AGENTS[conv.to]
      const toName = toAgent ? toAgent.name : conv.to
      wsBroadcast({
        type: 'office_agent_chat',
        from: conv.from,
        to: conv.to,
        to_name: toName,
        text: conv.text
      })
    }
  } catch (e) {
    console.error('[office] auto conversation error:', e.message)
  }

  // Schedule next conversation
  const nextDelay = 30000 + Math.random() * 30000 // 30-60 seconds
  conversationTimer = setTimeout(triggerAgentConversation, nextDelay)
}

// DISABLED: random demo chatter. Agents now talk only around real work
// (task-completion conversation lives in server-v2.js). Idle when no work.
// setTimeout(() => {
//   console.log('[office] Starting auto agent conversations...')
//   triggerAgentConversation()
// }, 10000)

// ── REST API ──

// Proxy /api/* → VOAI backend
app.use('/api', async (req, res) => {
  try {
    const url = VOAI_BACKEND + req.originalUrl
    const response = await fetch(url, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await response.text()
    res.status(response.status).send(data)
  } catch (e) {
    res.status(502).json({ error: 'VOAI backend unavailable' })
  }
})

// == Boss types in Slack panel (POST /chat) ==
//  "@agent (task|sang|tham): ..." -> assign + execute + QA   |   otherwise -> chat reply
async function handleBossChat(text) {
  const taskMatch = text.match(/^@(\w+)\s+(?:ทำ|สั่ง|task)\s*[:：]\s*(.+)/s)
  if (taskMatch && OFFICE_AGENTS[taskMatch[1].toLowerCase()]) {
    return handleBossTask(taskMatch[1].toLowerCase(), taskMatch[2].trim())
  }

  let cmd
  try { cmd = parseChatCommand(text) } catch { cmd = { agentId: 'hermes', message: text } }
  const agentId = OFFICE_AGENTS[cmd?.agentId] ? cmd.agentId : 'hermes'
  const agent = OFFICE_AGENTS[agentId]
  const role = FRONTEND_ROLE[agentId] || 'assistant'

  wsBroadcast({ type: 'chat_typing', sender: agent.name })
  let reply
  try {
    reply = await chatWithAgent(agentId, cmd?.message || text)
  } catch (e) {
    console.error('[office] boss chat AI error:', e.message)
    const p = agent.gender === 'male' ? 'ครับ' : 'ค่ะ'
    reply = 'ขออภัย' + p + ' ระบบ AI มีปัญหาชั่วคราว ลองใหม่นะ' + p
  }
  wsBroadcast({ type: 'chat_message', sender: agent.name, role, text: reply, timestamp: Date.now() })
}

// == Boss assigns a real task -> agent executes -> SysBot QA review ==
async function handleBossTask(agentId, taskTitle) {
  const agent = OFFICE_AGENTS[agentId]
  const role = FRONTEND_ROLE[agentId] || 'assistant'
  const p = agent.gender === 'male' ? 'ครับ' : 'ค่ะ'

  wsBroadcast({ type: 'chat_message', sender: agent.name, role, text: 'รับทราบ' + p + '! จะทำ "' + taskTitle + '" ให้เลย' + p, timestamp: Date.now() })

  try {
    await fetch(VOAI_BACKEND + '/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: taskTitle, assignee: agentId, type: 'general', priority: 'medium', description: 'สั่งจาก Office: ' + taskTitle, data: {} })
    })
  } catch (_) { /* best-effort */ }

  wsBroadcast({ type: 'chat_typing', sender: agent.name })
  wsBroadcast({ type: 'agent_working', agentId, status: 'กำลังทำ ' + taskTitle })
  let aiResult
  try {
    aiResult = await executeTaskWithAI({ title: taskTitle, assignee: agentId, description: taskTitle, type: 'general' })
  } catch (e) {
    console.error('[office] task exec error:', e.message)
    aiResult = { success: false, chatMessage: 'ทำงานไม่สำเร็จ' + p + ' ' + e.message }
  }
  wsBroadcast({ type: 'chat_message', sender: agent.name, role, text: aiResult.chatMessage, timestamp: Date.now() })
  wsBroadcast({ type: 'agent_completed', agentId, result: 'เสร็จงาน ' + taskTitle })

  if (aiResult.success) {
    const sys = OFFICE_AGENTS.sysbot
    wsBroadcast({ type: 'chat_typing', sender: sys.name })
    wsBroadcast({ type: 'agent_working', agentId: 'sysbot', status: 'ตรวจ QA' })
    let qa
    try {
      qa = await qaReviewTask({ title: taskTitle, assignee: agentId }, aiResult.rawResult || aiResult.chatMessage)
    } catch (e) {
      qa = { verdict: 'warn', chatMessage: 'ตรวจ QA ไม่สำเร็จ: ' + e.message }
    }
    const badge = qa.verdict === 'pass' ? ' ✅' : qa.verdict === 'fail' ? ' ❌' : ' ⚠️'
    wsBroadcast({ type: 'chat_message', sender: sys.name, role: 'ops', text: '🔍 QA: ' + qa.chatMessage + badge, timestamp: Date.now() })
    wsBroadcast({ type: 'agent_completed', agentId: 'sysbot', result: 'QA done' })
  }
}

// Slack chat-monitor toggle (frontend loads this on mount)
let chatCronPaused = false
app.get('/chat/cron-state', (req, res) => res.json({ paused: chatCronPaused }))
app.post('/chat/cron-state', (req, res) => { chatCronPaused = !!(req.body && req.body.paused); res.json({ ok: true, paused: chatCronPaused }) })

// Boss message endpoint
app.post('/chat', (req, res) => {
  const text = String((req.body && req.body.text) || '').trim()
  res.json({ ok: true })
  if (text) handleBossChat(text).catch(e => console.error('[office] handleBossChat:', e.message))
})

// Roster — MCP/server roster for the office sidebar (returns clean JSON so the
// frontend fetch never throws). Empty list = no external MCP roster wired up.
app.get('/roster', (req, res) => res.json({ mcpServers: [] }))

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'claude-office', ws: true, ai: true }))

// Serve static files (sprites, rooms, assets) BEFORE the catch-all route
app.use(express.static(STATIC_DIR))

// Office live page — serve the React build (index.html) which has full furniture renderer
app.get('/', (req, res) => {
  res.sendFile(join(STATIC_DIR, 'index.html'))
})

// Fallback for SPA routes — React Router handles client-side routing
app.get('*', (req, res) => {
  res.sendFile(join(STATIC_DIR, 'index.html'))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('🏢 Claude Office (AI-Powered) on port', PORT)
  console.log('📁 Static:', STATIC_DIR)
  console.log('🤖 AI Engine: Connected')
  console.log('🔌 WebSocket: /ws')
  console.log('💬 Chat: Real LLM (qwen3.7-plus)')
})
