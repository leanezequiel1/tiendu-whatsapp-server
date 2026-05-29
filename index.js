const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode   = require('qrcode-terminal')
const express  = require('express')

const app  = express()
app.use(express.json())

const PORT        = process.env.PORT || 3001
const API_SECRET  = process.env.API_SECRET || 'tiendu-secret'

let sock = null
let qrCode = null
let isConnected = false

// ─── Conexión WhatsApp ────────────────────────────────────────────────────────

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')

  sock = makeWASocket({
    auth:          state,
    printQRInTerminal: true,
    browser:       ['Tiendu', 'Chrome', '1.0.0'],
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
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('Conexión cerrada. Reconectando:', shouldReconnect)
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

// ─── API ──────────────────────────────────────────────────────────────────────

// Middleware de autenticación
function auth(req, res, next) {
  const secret = req.headers['x-api-secret']
  if (secret !== API_SECRET) return res.status(401).json({ error: 'No autorizado' })
  next()
}

// Estado de la conexión + QR
app.get('/status', (req, res) => {
  res.json({ connected: isConnected, hasQR: !!qrCode })
})

// Ver QR para escanear desde el browser
app.get('/qr', (req, res) => {
  if (!qrCode) return res.json({ ok: false, message: isConnected ? 'Ya conectado' : 'Sin QR disponible aún' })
  res.json({ ok: true, qr: qrCode })
})

// Enviar mensaje
app.post('/send', auth, async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp no conectado' })
  }

  const { phone, message } = req.body
  if (!phone || !message) {
    return res.status(400).json({ error: 'Faltan phone o message' })
  }

  try {
    // Normalizar número argentino: sacar todo lo que no sea dígito
    let number = phone.replace(/\D/g, '')

    // Si empieza con 0, sacar el 0
    if (number.startsWith('0')) number = number.slice(1)

    // Si no tiene código de país, agregar 54 (Argentina)
    if (!number.startsWith('54')) number = '54' + number

    // WhatsApp Argentina: agregar 9 después del 54 si no está
    // Formato: 549XXXXXXXXXX
    if (number.startsWith('54') && !number.startsWith('549')) {
      number = '549' + number.slice(2)
    }

    const jid = number + '@s.whatsapp.net'

    await sock.sendMessage(jid, { text: message })
    console.log(`✅ Mensaje enviado a ${jid}`)
    res.json({ ok: true, to: jid })
  } catch (err) {
    console.error('Error enviando mensaje:', err)
    res.status(500).json({ error: err.message })
  }
})

// Health check para Railway
app.get('/', (req, res) => res.json({ status: 'Tiendu WhatsApp Server running' }))

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`)
  connectToWhatsApp()
})
