const express   = require('express')
const QRCode    = require('qrcode')
const app       = express()
app.use(express.json())

const PORT       = process.env.PORT || 3001
const API_SECRET = process.env.API_SECRET || 'tiendu-secret'

let sock        = null
let qrCode      = null
let pairingCode = null
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

    const PHONE_NUMBER = process.env.PHONE_NUMBER // ej: 5491161073961
    const usePairing  = !!PHONE_NUMBER && !state.creds?.registered

    sock = makeWASocket({
      version,
      auth:   state,
      logger: pino({ level: 'silent' }),
      browser: ['Tiendu', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      retryRequestDelayMs: 2000,
    })

    // Usar código de vinculación si hay número configurado
    if (usePairing) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(PHONE_NUMBER)
          pairingCode = code?.match(/.{1,4}/g)?.join('-') || code
          console.log('[WA] 📲 CÓDIGO DE VINCULACIÓN:', pairingCode)
        } catch (e) {
          console.error('[WA] Error obteniendo código:', e.message)
        }
      }, 3000)
    }

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
  res.json({ connected: isConnected, hasQR: !!qrCode, pairingCode, error: startError })
})

app.get('/code', (req, res) => {
  if (isConnected) return res.send('<h2 style="font-family:sans-serif;color:green">✅ Ya conectado!</h2>')
  if (!pairingCode) return res.send(`
    <html><head><meta http-equiv="refresh" content="3"></head>
    <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>⏳ Generando código...</h2><p>Esta página se recarga sola</p>
    </body></html>`)
  res.send(`
    <html><head><meta http-equiv="refresh" content="60"></head>
    <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5">
      <h2>📱 Ingresá este código en WhatsApp Business</h2>
      <p>WhatsApp Business → ⋮ → <b>Dispositivos vinculados</b> → <b>Vincular con número de teléfono</b></p>
      <div style="font-size:48px;font-weight:bold;letter-spacing:8px;color:#6752E5;margin:30px 0;padding:20px;background:white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1)">${pairingCode}</div>
      <p style="color:#888">El código dura 60 segundos. La página se recarga sola.</p>
    </body></html>`)
})

app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send('<h2 style="font-family:sans-serif;color:green">✅ WhatsApp ya está conectado!</h2>')
  }
  if (!qrCode) {
    return res.send(`
      <html><head><meta http-equiv="refresh" content="3"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>⏳ Generando QR...</h2>
        <p>Esta página se recarga sola cada 3 segundos</p>
      </body></html>
    `)
  }
  try {
    const qrImage = await QRCode.toDataURL(qrCode, { width: 300 })
    res.send(`
      <html><head><meta http-equiv="refresh" content="30"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5">
        <h2>📱 Escaneá este QR con WhatsApp Business</h2>
        <p>Abrí WhatsApp Business → ⋮ → <b>Dispositivos vinculados</b> → <b>Vincular dispositivo</b></p>
        <img src="${qrImage}" style="border:8px solid white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.15)" />
        <p style="color:#888;font-size:13px">El QR expira en 60 segundos. La página se recarga sola.</p>
      </body></html>
    `)
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
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
