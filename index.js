const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const qrcode  = require('qrcode-terminal')
const express = require('express')
const pino    = require('pino')

const app = express()
app.use(express.json())

const PORT       = process.env.PORT || 3001
const API_SECRET = process.env.API_SECRET || 'tiendu-secret'

let sock        = null
let qrCode      = null
let isConnected = false

// ─── Conexión WhatsApp ────────────────────────────────────────────────────────

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth:   state,
    logger: pino({ level: 'silent' }),
    browser: ['Tiendu', 'Chrome', '1.0.0'],
  })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      qrCode = qr
      isConnected = false
      console.log('\n📱 Escaneá este QR con tu WhatsApp Business:\n')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'close') {
      isConnected = false
      qrCode = null
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      console.log('Conexión cerrada. Código:', statusCode, '- Reconectando:', shouldReconnect)
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000)
      }
    }

    if (connection === 'open') {
      isConnected = true
      qrCode = null
      console.log('✅ WhatsApp conectado!')
    }
  })

  sock.ev.on('creds.update', saveCreds)
}

// ─── Middleware auth ──────────────────────────────────────────────────────────

function auth(req, res, next) {
  const secret = req.headers['x-api-secret']
  if (secret !== API_SECRET) return res.status(401).json({ error: 'No autorizado' })
  next()
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.json({ status: 'Tiendu WhatsApp Server running ✅' }))

app.get('/status', (req, res) => {
  res.json({ connected: isConnected, hasQR: !!qrCode })
})

app.get('/qr', (req, res) => {
  if (!qrCode) return res.json({ ok: false, message: isConnected ? 'Ya conectado' : 'Sin QR aún, esperá unos segundos' })
  res.json({ ok: true, qr: qrCode })
})

app.post('/send', auth, async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp no conectado' })
  }

  const { phone, message } = req.body
  if (!phone || !message) {
    return res.status(400).json({ error: 'Faltan phone o message' })
  }

  try {
    // Normalizar número argentino → 549XXXXXXXXXX
    let number = phone.replace(/\D/g, '')
    if (number.startsWith('0')) number = number.slice(1)
    if (!number.startsWith('54')) number = '54' + number
    if (number.startsWith('54') && !number.startsWith('549')) {
      number = '549' + number.slice(2)
    }

    const jid = number + '@s.whatsapp.net'
    await sock.sendMessage(jid, { text: message })
    console.log('✅ Mensaje enviado a', jid)
    res.json({ ok: true, to: jid })
  } catch (err) {
    console.error('Error enviando mensaje:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('🚀 Servidor corriendo en puerto', PORT)
  connectToWhatsApp()
})
