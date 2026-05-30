const express = require('express')
const app     = express()
app.use(express.json())

const PORT       = process.env.PORT || 3001
const API_SECRET = process.env.API_SECRET || 'tiendu-secret'

let sock        = null
let qrCode      = null
let isConnected = false
let startError  = null

// ─── Conexión WhatsApp ────────────────────────────────────────────────────────

async function connectToWhatsApp() {
  try {
    console.log('[WA] Cargando Baileys...')
    const baileys = require('@whiskeysockets/baileys')
    const makeWASocket           = baileys.default
    const useMultiFileAuthState  = baileys.useMultiFileAuthState
    const DisconnectReason       = baileys.DisconnectReason
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion
    const qrcode = require('qrcode-terminal')
    const pino   = require('pino')

    console.log('[WA] Baileys cargado. Iniciando sesión...')
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    let version
    try {
      const res = await fetchLatestBaileysVersion()
      version = res.version
      console.log('[WA] Versión WA:', version)
    } catch (e) {
      version = [2, 3000, 1015901307]
      console.log('[WA] Usando versión por defecto:', version)
    }

    sock = makeWASocket({
      version,
      auth:   state,
      logger: pino({ level: 'silent' }),
      browser: ['Tiendu', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      retryRequestDelayMs: 2000,
    })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        qrCode = qr
        isConnected = false
        console.log('[WA] QR generado, esperando escaneo...')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'close') {
        isConnected = false
        qrCode = null
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const loggedOut  = statusCode === DisconnectReason.loggedOut
        console.log('[WA] Conexión cerrada. Código:', statusCode, '- loggedOut:', loggedOut)
        if (!loggedOut) {
          console.log('[WA] Reconectando en 5s...')
          setTimeout(connectToWhatsApp, 5000)
        }
      }

      if (connection === 'open') {
        isConnected = true
        qrCode = null
        console.log('[WA] ✅ Conectado!')
      }
    })

    sock.ev.on('creds.update', saveCreds)

  } catch (err) {
    startError = err.message
    console.error('[WA] Error al iniciar:', err)
    setTimeout(connectToWhatsApp, 10000)
  }
}

// ─── Rutas ────────────────────────────────────────────────────────────────────

function auth(req, res, next) {
  if (req.headers['x-api-secret'] !== API_SECRET) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}

app.get('/', (req, res) => {
  res.json({ status: 'Tiendu WhatsApp Server ✅', connected: isConnected, error: startError })
})

app.get('/status', (req, res) => {
  res.json({ connected: isConnected, hasQR: !!qrCode, error: startError })
})

app.get('/qr', (req, res) => {
  if (!qrCode) {
    return res.json({ ok: false, message: isConnected ? 'Ya conectado' : 'QR no disponible aún, esperá unos segundos y recargá' })
  }
  res.json({ ok: true, qr: qrCode })
})

app.post('/send', auth, async (req, res) => {
  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp no conectado', hasQR: !!qrCode })
  }
  const { phone, message } = req.body
  if (!phone || !message) {
    return res.status(400).json({ error: 'Faltan phone o message' })
  }
  try {
    let number = phone.replace(/\D/g, '')
    if (number.startsWith('0')) number = number.slice(1)
    if (!number.startsWith('54')) number = '54' + number
    if (!number.startsWith('549')) number = '549' + number.slice(2)
    const jid = number + '@s.whatsapp.net'
    await sock.sendMessage(jid, { text: message })
    console.log('[WA] ✅ Mensaje enviado a', jid)
    res.json({ ok: true, to: jid })
  } catch (err) {
    console.error('[WA] Error enviando:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor en puerto ${PORT}`)
  connectToWhatsApp()
})
