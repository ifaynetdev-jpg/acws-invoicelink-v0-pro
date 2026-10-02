import { createClient } from "@supabase/supabase-js"
const DATA_KEYS = [
  "acws_consumers",
  "acws_products",
  "acws_invoices",
  "acws_settings",
  "acws_templates",
  "acws_logs",
  "acws_mobile_mode",
]
const COLLECTION_KEYS = new Set([
  "acws_consumers",
  "acws_products",
  "acws_invoices",
  "acws_logs",
])
const OBJECT_KEYS = new Set(["acws_settings", "acws_templates"])
const LABELS = {
  acws_consumers: "Pelanggan",
  acws_products: "Paket harga",
  acws_invoices: "Tagihan",
  acws_templates: "Template pesan",
  acws_settings: "Pengaturan usaha",
  acws_logs: "Riwayat aktivitas",
  acws_mobile_mode: "Mode seluler",
}
const CUSTOMER_COLUMNS = {
  id: ["id", "id pelanggan", "kode pelanggan", "nomor pelanggan", "no pelanggan", "customer id", "customerid"],
  nama: ["nama", "nama pelanggan", "nama lengkap", "pelanggan", "customer", "customer name", "name"],
  alamat: ["alamat", "alamat pelanggan", "address"],
  wa: ["wa", "wa pelanggan", "no wa", "nomor wa", "whatsapp", "no whatsapp", "nomor whatsapp", "telepon", "no hp", "nomor hp", "handphone", "phone", "mobile"],
  email: ["email", "alamat email", "e mail"],
  paket: ["paket", "paket internet", "nama paket", "layanan", "package", "plan"],
  harga: ["harga", "harga paket", "tarif", "biaya", "tagihan", "jumlah tagihan", "monthly fee", "price", "amount"],
  tglDaftar: ["tgl daftar", "tanggal daftar", "tgl pendaftaran", "tanggal pendaftaran", "tanggal berlangganan", "registration date", "join date"],
  tglJatuhTempo: ["tgl jatuh tempo", "tanggal jatuh tempo", "jatuh tempo", "tanggal pembayaran", "billing day", "due date"],
}
const CUSTOMER_EXPORT_COLUMNS = [
  ["ID", "id"],
  ["Nama Pelanggan", "nama"],
  ["Alamat", "alamat"],
  ["WhatsApp", "wa"],
  ["Email", "email"],
  ["Paket", "paket"],
  ["Harga", "harga"],
  ["Tanggal Daftar", "tglDaftar"],
  ["Tanggal Jatuh Tempo", "tglJatuhTempo"],
]
const CUSTOMER_SHEET_NAMES = new Set([
  "pelanggan", "datapelanggan", "daftarpelanggan", "konsumen", "datakonsumen",
  "customer", "customers", "customerdata", "customersdata", "client", "clients",
])
const BACKUP_FORMAT = "ACWS.InvoiceLink.Backup"
const DEFAULT_SYNC_INTERVAL = 12000

let client
let currentUser = null
let accountReady = false
let syncStatus = "Menyiapkan keamanan akun…"
let syncError = ""
let cloudSnapshot = ""
let localSnapshot = ""
let workPromise = Promise.resolve()
let debounceTimer
let pollTimer
let syncing = false
let stopped = false

const safeJson = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function readLocalData() {
  return Object.fromEntries(
    DATA_KEYS.filter((key) => localStorage.getItem(key) !== null).map((key) => [
      key,
      safeJson(localStorage.getItem(key)),
    ]),
  )
}

function isValidData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false
  for (const [key, value] of Object.entries(data)) {
    if (!DATA_KEYS.includes(key)) return false
    if (COLLECTION_KEYS.has(key) && !Array.isArray(value)) return false
    if (OBJECT_KEYS.has(key) && (!value || typeof value !== "object" || Array.isArray(value))) return false
    if (key === "acws_mobile_mode" && typeof value !== "boolean") return false
  }
  return true
}

function dataSignature(data) {
  return JSON.stringify(Object.fromEntries(DATA_KEYS.map((key) => [key, data[key] ?? null])))
}

function applyLocalData(data, { reload = false } = {}) {
  for (const key of DATA_KEYS) {
    if (Object.hasOwn(data, key)) localStorage.setItem(key, JSON.stringify(data[key]))
    else localStorage.removeItem(key)
  }
  const snapshot = dataSignature(readLocalData())
  localSnapshot = snapshot
  if (!reload) return

  const guard = sessionStorage.getItem("acws_cloud_reload_digest")
  if (guard === snapshot) {
    sessionStorage.removeItem("acws_cloud_reload_digest")
    return
  }
  sessionStorage.setItem("acws_cloud_reload_digest", snapshot)
  window.location.reload()
}

function setStatus(message, error = "") {
  syncStatus = message
  syncError = error
  render()
}

function button(label, action, style = "secondary") {
  const el = document.createElement("button")
  el.type = "button"
  el.textContent = label
  el.dataset.style = style
  el.addEventListener("click", action)
  return el
}

function createStyles() {
  if (document.getElementById("acws-account-styles")) return
  const style = document.createElement("style")
  style.id = "acws-account-styles"
  style.textContent = `
    #acws-account-gate[hidden],#acws-data-panel[hidden]{display:none!important}
    #acws-account-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:#f3f1ec;color:#16191c;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #acws-account-gate *{box-sizing:border-box}
    .acws-auth-card{width:min(100%,390px);padding:26px 22px;border:1px solid #e8e5de;border-radius:22px;background:#fff;box-shadow:0 20px 65px #18212614}
    .acws-auth-brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
    .acws-auth-logo{width:44px;height:44px;border-radius:13px;object-fit:cover;background:#f0eee8}
    .acws-auth-name{margin:0;font-size:14px;font-weight:750;letter-spacing:-.02em}
    .acws-auth-eyebrow{margin:0 0 6px;color:#4c735c;font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}
    .acws-auth-title{margin:0;font-size:24px;line-height:1.12;letter-spacing:-.04em}
    .acws-auth-copy{margin:10px 0 22px;color:#5a6165;font-size:13px;line-height:1.55}
    .acws-auth-label{display:block;margin:0 0 7px;font-size:12px;font-weight:700}
    .acws-auth-input{display:block;width:100%;height:46px;padding:0 13px;border:1px solid #d8d9d5;border-radius:11px;background:#fff;color:#171a1c;font:inherit;font-size:14px;outline:none}
    .acws-auth-input:focus{border-color:#407451;box-shadow:0 0 0 3px #40745120}
    .acws-auth-button{display:flex;width:100%;min-height:45px;align-items:center;justify-content:center;padding:10px 14px;border:0;border-radius:11px;background:#214b36;color:#fff;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
    .acws-auth-button:disabled{opacity:.6;cursor:wait}
    .acws-auth-message{min-height:18px;margin:9px 0 0;color:#5d6465;font-size:12px;line-height:1.45}
    .acws-auth-message[data-error="true"]{color:#a33832}
    .acws-auth-divider{height:1px;margin:17px 0;background:#efede8}
    .acws-auth-legacy{padding:0;border:0;background:transparent;color:#48574e;font:inherit;font-size:12px;font-weight:650;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
    .acws-auth-foot{margin:14px 0 0;color:#737876;font-size:11px;line-height:1.5}
    #acws-data-toggle{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147482000;min-height:42px;padding:0 14px;border:1px solid #d9ded8;border-radius:14px;background:#fff;color:#183d2b;box-shadow:0 7px 24px #10181320;font:600 12px ui-sans-serif,system-ui,sans-serif;cursor:pointer}
    #acws-data-panel{position:fixed;right:12px;bottom:calc(62px + env(safe-area-inset-bottom));z-index:2147482000;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 88px - env(safe-area-inset-bottom));overflow-y:auto;padding:16px;border:1px solid #e3e5df;border-radius:18px;background:#fff;color:#16191c;box-shadow:0 16px 50px #10181324;font-family:ui-sans-serif,system-ui,sans-serif}
    .acws-panel-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .acws-panel-title{margin:0;font-size:14px;font-weight:750}
    .acws-panel-email{overflow:hidden;margin:4px 0 0;color:#656c68;font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .acws-panel-status{margin:12px 0;padding:9px 10px;border-radius:10px;background:#f2f5f1;color:#36553f;font-size:11px;line-height:1.4;overflow-wrap:anywhere}
    .acws-panel-status[data-error="true"]{background:#fff0ee;color:#9b342e}
    .acws-panel-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .acws-panel-grid button,.acws-panel-signout{min-height:40px;padding:8px;border:1px solid #dfe2dc;border-radius:10px;background:#fff;color:#202722;font:600 11px ui-sans-serif,system-ui,sans-serif;cursor:pointer}
    .acws-panel-grid button[data-style="primary"]{border-color:#214b36;background:#214b36;color:#fff}
    .acws-panel-section{margin-top:12px}
    .acws-panel-section-title{margin:0 0 8px;font-size:11px;font-weight:750}
    .acws-panel-signout{width:100%;margin-top:9px;color:#75514b}
    .acws-panel-note{margin:10px 0 0;color:#767d78;font-size:10px;line-height:1.45}
    .acws-panel-close{flex:0 0 auto;padding:4px 7px;border:0;background:transparent;color:#676e69;font-size:18px;cursor:pointer}
    @media(max-width:360px){.acws-auth-card{padding:22px 18px}.acws-auth-title{font-size:22px}}
  `
  document.head.append(style)
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function emailSendErrorMessage(error) {
  const code = String(error?.code || "")
  const message = String(error?.message || "")
  if (code === "over_email_send_rate_limit" || Number(error?.status) === 429 || /rate.?limit|too many requests/i.test(message)) {
    return "Pengiriman kode sedang dibatasi karena terlalu banyak permintaan. Jangan kirim ulang berulang; tunggu hingga batas kirim pulih. Untuk login email yang andal, pemilik proyek perlu mengatur layanan SMTP email khusus di Supabase."
  }
  if (code === "email_address_not_authorized") {
    return "Email ini belum diizinkan oleh layanan email uji Supabase. Pemilik proyek perlu mengatur layanan SMTP email khusus agar kode dapat dikirim ke alamat Anda."
  }
  return "Kode belum dapat dikirim. Periksa alamat email dan koneksi, lalu coba lagi."
}

function makeGate() {
  let gate = document.getElementById("acws-account-gate")
  if (gate) return gate
  gate = document.createElement("section")
  gate.id = "acws-account-gate"
  gate.setAttribute("aria-label", "Login akun ACWS")
  gate.innerHTML = `
    <div class="acws-auth-card">
      <div class="acws-auth-brand"><img class="acws-auth-logo" src="./acws-logo-120.png" alt=""><p class="acws-auth-name">ACWS InvoiceLink V.0 PRO</p></div>
      <p class="acws-auth-eyebrow">Akun dan sinkronisasi cloud</p>
      <h1 class="acws-auth-title" id="acws-auth-title">Masuk dengan email</h1>
      <p class="acws-auth-copy" id="acws-auth-copy">Kode email menghubungkan akun dan menyinkronkan data. Kode aplikasi lama serta lisensi yang berlaku tetap dipakai sementara.</p>
      <form id="acws-auth-form" novalidate>
        <label class="acws-auth-label" for="acws-email">Alamat email</label>
        <input class="acws-auth-input" id="acws-email" name="email" type="email" autocomplete="email" placeholder="nama@email.com" required>
        <button class="acws-auth-button" id="acws-auth-submit" type="submit" style="margin-top:12px">Kirim kode email</button>
      </form>
      <p class="acws-auth-message" id="acws-auth-message" role="status" aria-live="polite"></p>
      <div class="acws-auth-divider"></div>
      <button class="acws-auth-legacy" id="acws-auth-legacy" type="button">Lanjutkan dengan login lama di perangkat ini</button>
      <p class="acws-auth-foot">Data login lama tetap di perangkat ini dan belum tersinkron. Login lama serta lisensi aplikasi tetap tersedia sementara.</p>
    </div>`
  document.body.append(gate)

  const form = gate.querySelector("#acws-auth-form")
  const emailInput = gate.querySelector("#acws-email")
  const message = gate.querySelector("#acws-auth-message")
  const submit = gate.querySelector("#acws-auth-submit")
  let email = ""

  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (!client) {
      message.textContent = "Layanan akun belum dapat dihubungi. Coba muat ulang halaman."
      message.dataset.error = "true"
      return
    }
    if (form.querySelector("#acws-auth-submit")?.dataset.step === "verify") {
      const token = gate.querySelector("#acws-otp")?.value.trim()
      const verifyButton = form.querySelector("#acws-auth-submit")
      if (!/^(?:\d{6}|\d{8})$/.test(token || "")) {
        message.textContent = "Masukkan kode 6 atau 8 digit yang dikirim ke email Anda."
        message.dataset.error = "true"
        return
      }
      verifyButton.disabled = true
      verifyButton.textContent = "Memeriksa kode…"
      const { error } = await client.auth.verifyOtp({ email, token, type: "email" })
      verifyButton.disabled = false
      verifyButton.textContent = "Verifikasi dan lanjutkan"
      if (error) {
        message.textContent = "Kode tidak valid atau sudah kedaluwarsa. Periksa email, lalu coba lagi."
        message.dataset.error = "true"
        return
      }
      message.dataset.error = "false"
      message.textContent = "Email terverifikasi. Menyiapkan data akun…"
      return
    }

    email = emailInput.value.trim().toLowerCase()
    if (!emailInput.checkValidity() || !email) {
      emailInput.reportValidity()
      return
    }
    submit.disabled = true
    submit.textContent = "Mengirim kode…"
    let error
    try {
      ({ error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      }))
    } catch (requestError) {
      error = requestError
    }
    submit.disabled = false
    submit.textContent = "Kirim kode email"
    if (error) {
      message.textContent = emailSendErrorMessage(error)
      message.dataset.error = "true"
      return
    }
    message.dataset.error = "false"
    message.textContent = "Jika email dapat menerima pesan, kode verifikasi akan segera tiba."
    form.innerHTML = `
      <label class="acws-auth-label" for="acws-otp">Kode verifikasi dari email</label>
      <input class="acws-auth-input" id="acws-otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}|[0-9]{8}" maxlength="8" placeholder="Masukkan kode dari email" required>
      <button class="acws-auth-button" id="acws-auth-submit" type="submit" style="margin-top:12px">Verifikasi dan lanjutkan</button>
      <button class="acws-auth-legacy" id="acws-resend-code" type="button" style="margin-top:14px">Kirim ulang kode</button>`
    gate.querySelector("#acws-auth-title").textContent = "Periksa email Anda"
    gate.querySelector("#acws-auth-copy").textContent = `Masukkan kode sekali pakai yang dikirim ke ${email}.`
    gate.querySelector("#acws-auth-submit").dataset.step = "verify"
    gate.querySelector("#acws-resend-code").addEventListener("click", async () => {
      const resendButton = gate.querySelector("#acws-resend-code")
      resendButton.disabled = true
      let resendError
      try {
        const resend = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
        resendError = resend.error
      } catch (requestError) {
        resendError = requestError
      }
      resendButton.disabled = false
      message.dataset.error = String(Boolean(resendError))
      message.textContent = resendError ? emailSendErrorMessage(resendError) : "Kode baru dikirim. Gunakan kode terbaru di email Anda."
    })
    gate.querySelector("#acws-otp").focus()
  })

  gate.querySelector("#acws-auth-legacy").addEventListener("click", () => {
    sessionStorage.setItem("acws_legacy_access", "true")
    render()
  })
  return gate
}

async function buildWorkbook(data) {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ACWS InvoiceLink V.0 PRO"
  workbook.created = new Date()

  const addRows = (name, key) => {
    const rows = Array.isArray(data[key]) ? data[key] : []
    const sheet = workbook.addWorksheet(name)
    const headers = rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row)))] : ["Informasi"]
    sheet.columns = headers.map((header) => ({ header, key: header, width: 22 }))
    if (rows.length) {
      for (const row of rows) {
        sheet.addRow(Object.fromEntries(headers.map((header) => {
          const value = row[header]
          return [header, value && typeof value === "object" ? JSON.stringify(value) : value]
        })))
      }
    } else {
      sheet.addRow({ Informasi: `Belum ada ${LABELS[key].toLowerCase()}.` })
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }]
  }

  addRows("Pelanggan", "acws_consumers")
  addRows("Paket Harga", "acws_products")
  addRows("Tagihan", "acws_invoices")
  addRows("Riwayat", "acws_logs")

  for (const [name, key, fallback] of [
    ["Pengaturan", "acws_settings", {}],
    ["Template", "acws_templates", {}],
    ["Mode Seluler", "acws_mobile_mode", false],
  ]) {
    const sheet = workbook.addWorksheet(name)
    sheet.columns = [{ header: "data", key: "data", width: 80 }]
    sheet.addRow({ data: JSON.stringify(data[key] ?? fallback) })
  }

  const backup = workbook.addWorksheet("_ACWS_BACKUP")
  backup.state = "veryHidden"
  backup.addRow(["key", "chunk", "data"])
  for (const key of DATA_KEYS) {
    if (!Object.hasOwn(data, key)) continue
    const serialized = JSON.stringify(data[key])
    for (let start = 0, chunk = 0; start < serialized.length; start += 30000, chunk += 1) {
      backup.addRow([key, chunk, serialized.slice(start, start + 30000)])
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `ACWS-Backup-${new Date().toISOString().slice(0, 10)}.xlsx`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function buildCustomerWorkbook(customers) {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ACWS InvoiceLink V.0 PRO"
  workbook.created = new Date()
  const sheet = workbook.addWorksheet("Pelanggan")
  const knownKeys = new Set(CUSTOMER_EXPORT_COLUMNS.map(([, key]) => key))
  const extraKeys = [...new Set(customers.flatMap((customer) => Object.keys(customer || {})))].filter((key) => !knownKeys.has(key))
  sheet.columns = [
    ...CUSTOMER_EXPORT_COLUMNS.map(([header, key]) => ({ header, key, width: 22 })),
    ...extraKeys.map((key) => ({ header: key, key, width: 22 })),
  ]
  for (const customer of customers) {
    sheet.addRow(Object.fromEntries(
      [...CUSTOMER_EXPORT_COLUMNS.map(([, key]) => key), ...extraKeys].map((key) => {
        const value = customer?.[key]
        return [key, value && typeof value === "object" ? JSON.stringify(value) : value ?? ""]
      }),
    ))
  }
  if (!customers.length) sheet.addRow({ "Nama Pelanggan": "" })
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `ACWS-Pelanggan-${new Date().toISOString().slice(0, 10)}.xlsx`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function parseWorkbook(buffer) {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const backup = workbook.getWorksheet("_ACWS_BACKUP")
  if (backup) {
    const chunks = new Map()
    for (let rowNumber = 2; rowNumber <= backup.rowCount; rowNumber += 1) {
      const row = backup.getRow(rowNumber)
      const key = row.getCell(1).value
      if (typeof key !== "string" || !DATA_KEYS.includes(key)) continue
      const entries = chunks.get(key) || []
      entries[row.getCell(2).value || 0] = String(row.getCell(3).value ?? "")
      chunks.set(key, entries)
    }
    const completeData = Object.fromEntries([...chunks].map(([key, parts]) => [key, JSON.parse(parts.join(""))]))
    if (!isValidData(completeData)) throw new Error("Isi cadangan Excel tidak lengkap atau tidak valid.")
    return completeData
  }

  const sheetRows = (name) => {
    const sheet = workbook.getWorksheet(name)
    if (!sheet || sheet.rowCount < 2) return []
    const headers = sheet.getRow(1).values.slice(1).map((header) => String(header ?? ""))
    return Array.from({ length: sheet.rowCount - 1 }, (_, index) => {
      const row = sheet.getRow(index + 2)
      return Object.fromEntries(headers.map((header, column) => {
        const value = row.getCell(column + 1).value
        return [header, value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value]
      }))
    }).filter((row) => !Object.hasOwn(row, "Informasi"))
  }
  const parseDataSheet = (name, fallback) => {
    const value = sheetRows(name)[0]?.data
    return value === undefined ? fallback : JSON.parse(String(value))
  }
  const data = {
    acws_consumers: sheetRows("Pelanggan"),
    acws_products: sheetRows("Paket Harga"),
    acws_invoices: sheetRows("Tagihan"),
    acws_logs: sheetRows("Riwayat"),
    acws_settings: parseDataSheet("Pengaturan", {}),
    acws_templates: parseDataSheet("Template", {}),
    acws_mobile_mode: parseDataSheet("Mode Seluler", false),
  }
  if (!workbook.getWorksheet("Pelanggan") && !workbook.getWorksheet("Paket Harga") && !workbook.getWorksheet("Tagihan")) {
    throw new Error("Lembar Pelanggan, Paket Harga, atau Tagihan tidak ditemukan.")
  }
  if (!isValidData(data)) throw new Error("Format data Excel tidak sesuai dengan ACWS InvoiceLink.")
  return data
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("id-ID")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

const CUSTOMER_HEADER_LOOKUP = new Map(
  Object.entries(CUSTOMER_COLUMNS).flatMap(([key, aliases]) =>
    [key, ...aliases].map((alias) => [normalizeHeader(alias), key]),
  ),
)

function excelCellValue(value) {
  if (value == null) return ""
  if (value instanceof Date) return value
  if (typeof value !== "object") return value
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("")
  if (Object.hasOwn(value, "result")) return excelCellValue(value.result)
  if (typeof value.text === "string") return value.text
  if (typeof value.hyperlink === "string") return value.text || value.hyperlink
  return JSON.stringify(value)
}

function localDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseCustomerDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateString(value)
  const text = String(value ?? "").trim()
  if (!text) return ""
  const localDate = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
  if (localDate) return `${localDate[3]}-${String(localDate[2]).padStart(2, "0")}-${String(localDate[1]).padStart(2, "0")}`
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDate) return isoDate[1]
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? text : localDateString(parsed)
}

function parseDueDay(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return String(value.getDate())
  const text = String(value ?? "").trim()
  if (!text) return ""
  const date = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
  if (date) return String(Number(date[1]))
  const isoDate = text.match(/^\d{4}-\d{2}-(\d{2})/)
  if (isoDate) return String(Number(isoDate[1]))
  return text
}

function parseCustomerPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  let text = String(value ?? "").trim().replace(/[^\d,.-]/g, "")
  if (!text) return 0
  const comma = text.lastIndexOf(",")
  const dot = text.lastIndexOf(".")
  if (comma !== -1 && dot !== -1) {
    const decimal = comma > dot ? "," : "."
    text = text.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".")
  } else if (comma !== -1 || dot !== -1) {
    const separator = comma !== -1 ? "," : "."
    const count = text.split(separator).length - 1
    const trailingDigits = text.length - text.lastIndexOf(separator) - 1
    if (count > 1 || trailingDigits === 3) text = text.replace(/[,.]/g, "")
    else text = text.replace(separator, ".")
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

async function parseCustomerWorkbook(buffer) {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const candidates = workbook.worksheets.flatMap((sheet) => {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber += 1) {
      const headers = sheet.getRow(rowNumber).values.slice(1).map((value) => String(excelCellValue(value) ?? "").trim())
      const fields = headers.map((header) => CUSTOMER_HEADER_LOOKUP.get(normalizeHeader(header)) || null)
      if (fields.includes("nama")) {
        return [{ sheet, headerRow: rowNumber, headers, fields, named: CUSTOMER_SHEET_NAMES.has(normalizeHeader(sheet.name)) }]
      }
    }
    return []
  }).sort((left, right) => Number(right.named) - Number(left.named))
  const selected = candidates[0]
  if (!selected) throw new Error("Kolom nama pelanggan tidak ditemukan. Gunakan kolom Nama, Nama Pelanggan, Customer, atau Name.")
  if (selected.sheet.rowCount > 50001) throw new Error("File memuat terlalu banyak baris. Batas impor adalah 50.000 pelanggan.")
  const customers = []
  for (let rowNumber = selected.headerRow + 1; rowNumber <= selected.sheet.rowCount; rowNumber += 1) {
    const row = selected.sheet.getRow(rowNumber)
    const customer = {}
    selected.headers.forEach((header, index) => {
      if (!header || ["__proto__", "prototype", "constructor"].includes(header.toLowerCase())) return
      const value = excelCellValue(row.getCell(index + 1).value)
      if (value === "" || value == null) return
      const field = selected.fields[index]
      const key = field || header
      if (field === "harga") customer[key] = parseCustomerPrice(value)
      else if (field === "tglDaftar") customer[key] = parseCustomerDate(value)
      else if (field === "tglJatuhTempo") customer[key] = parseDueDay(value)
      else if (["nama", "alamat", "wa", "email", "paket"].includes(field)) customer[key] = String(value)
      else customer[key] = value
    })
    if (String(customer.nama ?? "").trim()) customers.push(customer)
  }
  return customers
}

function normalizeCustomerPhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "")
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`
  return digits.length >= 8 ? digits : ""
}

function mergeCustomerRows(existingRows, importedRows) {
  const customers = [...existingRows]
  let added = 0
  let updated = 0
  for (const imported of importedRows) {
    const phone = normalizeCustomerPhone(imported.wa)
    const email = String(imported.email ?? "").trim().toLowerCase()
    const index = customers.findIndex((customer) =>
      (imported.id != null && customer?.id != null && String(customer.id) === String(imported.id)) ||
      (phone && normalizeCustomerPhone(customer?.wa) === phone) ||
      (email && String(customer?.email ?? "").trim().toLowerCase() === email),
    )
    if (index >= 0) {
      customers[index] = { ...customers[index], ...imported, id: customers[index].id ?? imported.id }
      updated += 1
    } else {
      const ids = new Set(customers.map((customer) => String(customer.id ?? "")))
      const id = imported.id != null && !ids.has(String(imported.id)) ? imported.id : crypto.randomUUID()
      customers.push({ tglDaftar: new Date().toISOString().slice(0, 10), tglJatuhTempo: "10", harga: 0, ...imported, id })
      added += 1
    }
  }
  return { customers, added, updated }
}

async function importCustomers(file) {
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error("Pilih berkas Excel .xlsx. Berkas .xls lama perlu disimpan ulang sebagai .xlsx terlebih dahulu.")
    if (file.size > 25 * 1024 * 1024) throw new Error("Berkas Excel melebihi batas 25 MB.")
    const imported = await parseCustomerWorkbook(await file.arrayBuffer())
    if (!imported.length) throw new Error("Tidak ada baris pelanggan dengan nama yang valid di dalam berkas.")
    const local = readLocalData()
    const { customers, added, updated } = mergeCustomerRows(local.acws_consumers || [], imported)
    if (!window.confirm(`Gabungkan ${imported.length} pelanggan dari Excel? ${added} pelanggan baru akan ditambahkan dan ${updated} yang cocok akan diperbarui. Data lain tidak berubah.`)) return
    const mergedData = { ...local, acws_consumers: customers }
    applyLocalData(mergedData)
    if (currentUser && !(await writeCloudData(mergedData))) {
      throw new Error("Pelanggan diimpor ke perangkat ini, tetapi belum tersinkron. Periksa koneksi lalu coba lagi.")
    }
    setStatus(currentUser
      ? `${added} pelanggan ditambahkan, ${updated} diperbarui, dan disinkronkan ke akun.`
      : `${added} pelanggan ditambahkan, ${updated} diperbarui di perangkat ini. Masuk ke akun email untuk sinkronisasi lintas perangkat.`)
    window.setTimeout(() => window.location.reload(), 450)
  } catch (error) {
    setStatus("Migrasi pelanggan belum berhasil.", error instanceof Error ? error.message : "Periksa format Excel dan coba lagi.")
  }
}

async function importFile(file) {
  try {
    let data
    if (file.name.toLowerCase().endsWith(".json")) {
      const payload = JSON.parse(await file.text())
      if (payload.format !== BACKUP_FORMAT || payload.version !== 1) {
        throw new Error("File JSON bukan cadangan ACWS InvoiceLink yang didukung.")
      }
      data = payload.data
      if (!isValidData(data)) throw new Error("Isi file JSON tidak lengkap atau tidak valid.")
    } else if (/\.xlsx$/i.test(file.name)) {
      data = await parseWorkbook(await file.arrayBuffer())
    } else {
      throw new Error("Pilih file .json atau .xlsx.")
    }

    const confirmText = "Impor ini akan mengganti data pelanggan, paket, tagihan, dan pengaturan lokal pada perangkat ini. Lanjutkan?"
    if (!window.confirm(confirmText)) return
    applyLocalData(data)
    if (currentUser) {
      const saved = await writeCloudData(data)
      if (!saved) throw new Error("Impor tersimpan di perangkat, tetapi belum berhasil disinkronkan ke cloud.")
    }
    setStatus(currentUser ? "Data berhasil diimpor dan disinkronkan." : "Data diimpor di perangkat ini. Masuk dengan email untuk sinkronisasi cloud.")
    window.setTimeout(() => window.location.reload(), 450)
  } catch (error) {
    setStatus("Impor belum berhasil.", error instanceof Error ? error.message : "Periksa format file dan coba lagi.")
  }
}

function installDataPanel() {
  if (!document.getElementById("acws-data-toggle")) {
    const toggle = button("Data & akun", () => {
      const panel = document.getElementById("acws-data-panel")
      panel.hidden = !panel.hidden
      toggle.setAttribute("aria-expanded", String(!panel.hidden))
    })
    toggle.id = "acws-data-toggle"
    toggle.setAttribute("aria-expanded", "false")
    toggle.setAttribute("aria-controls", "acws-data-panel")
    document.body.append(toggle)
  }
  if (document.getElementById("acws-data-panel")) return

  const panel = document.createElement("section")
  panel.id = "acws-data-panel"
  panel.hidden = true
  panel.setAttribute("aria-label", "Impor ekspor dan sinkronisasi data")
  const top = makeElement("div", "acws-panel-top")
  const account = makeElement("div")
  account.append(makeElement("p", "acws-panel-title", "Data ACWS"))
  account.append(makeElement("p", "acws-panel-email", currentUser?.email || "Login lama · perangkat ini"))
  const close = button("×", () => {
    panel.hidden = true
    document.getElementById("acws-data-toggle")?.setAttribute("aria-expanded", "false")
  })
  close.className = "acws-panel-close"
  close.setAttribute("aria-label", "Tutup menu data")
  top.append(account, close)
  const status = makeElement("p", "acws-panel-status", syncStatus)
  status.id = "acws-panel-status"
  const controls = makeElement("div", "acws-panel-grid")
  controls.append(
    button("Ekspor Excel", async () => {
      try {
        await buildWorkbook(readLocalData())
        setStatus("Berkas Excel berhasil dibuat.")
      } catch {
        setStatus("Ekspor Excel belum berhasil.", "Periksa ruang penyimpanan perangkat dan coba lagi.")
      }
    }, "primary"),
    button("Ekspor JSON", () => {
      const backup = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), data: readLocalData() }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `ACWS-Backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }),
  )
  const customerSection = makeElement("section", "acws-panel-section")
  customerSection.setAttribute("aria-label", "Migrasi pelanggan melalui Excel")
  customerSection.append(makeElement("p", "acws-panel-section-title", "Migrasi pelanggan melalui Excel"))
  const customerControls = makeElement("div", "acws-panel-grid")
  customerControls.append(
    button("Ekspor Excel", async () => {
      try {
        await buildCustomerWorkbook(readLocalData().acws_consumers || [])
        setStatus("File Excel pelanggan berhasil dibuat.")
      } catch {
        setStatus("Ekspor pelanggan belum berhasil.", "Periksa ruang penyimpanan perangkat dan coba lagi.")
      }
    }, "primary"),
    button("Impor Excel", () => { customerExcelInput.value = ""; customerExcelInput.click() }),
  )
  customerSection.append(customerControls)
  const jsonInput = document.createElement("input")
  jsonInput.type = "file"
  jsonInput.accept = ".json,application/json"
  jsonInput.hidden = true
  jsonInput.addEventListener("change", () => jsonInput.files?.[0] && importFile(jsonInput.files[0]))
  const excelInput = document.createElement("input")
  excelInput.type = "file"
  excelInput.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  excelInput.hidden = true
  excelInput.addEventListener("change", () => excelInput.files?.[0] && importFile(excelInput.files[0]))
  const customerExcelInput = document.createElement("input")
  customerExcelInput.type = "file"
  customerExcelInput.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  customerExcelInput.hidden = true
  customerExcelInput.addEventListener("change", () => {
    const file = customerExcelInput.files?.[0]
    if (file) importCustomers(file)
    customerExcelInput.value = ""
  })
  controls.append(
    button("Impor JSON", () => { jsonInput.value = ""; jsonInput.click() }),
    button("Impor Excel lengkap", () => { excelInput.value = ""; excelInput.click() }),
  )
  const note = makeElement("p", "acws-panel-note", "Di perangkat lama, ekspor data pelanggan ke Excel. Lalu masuk dengan akun email baru dan impor berkasnya di sini. Data yang cocok digabung; tagihan dan pengaturan tidak diganti. Setelah tersinkron, pelanggan tersedia di perangkat mana pun saat masuk dengan akun yang sama. Berkas .xls perlu disimpan ulang sebagai .xlsx.")
  const signout = button(currentUser ? "Keluar dari akun cloud" : "Masuk dengan email untuk sinkronisasi", async () => {
    if (!client) return
    if (!currentUser) {
      sessionStorage.removeItem("acws_legacy_access")
      render()
      return
    }
    await client.auth.signOut()
    sessionStorage.removeItem("acws_legacy_access")
    window.location.reload()
  })
  signout.className = "acws-panel-signout"
  panel.append(top, status, controls, customerSection, jsonInput, excelInput, customerExcelInput, note, signout)
  document.body.append(panel)
}

function render() {
  createStyles()
  const gate = makeGate()
  const legacyMode = sessionStorage.getItem("acws_legacy_access") === "true"
  gate.hidden = (Boolean(currentUser) && accountReady) || legacyMode
  const toggle = document.getElementById("acws-data-toggle")
  const panel = document.getElementById("acws-data-panel")
  if (currentUser || legacyMode) installDataPanel()
  if (toggle) toggle.hidden = gate.hidden
  if (panel) {
    const email = panel.querySelector(".acws-panel-email")
    if (email) email.textContent = currentUser?.email || "Login lama · perangkat ini"
    const status = panel.querySelector(".acws-panel-status")
    if (status) {
      status.textContent = syncError || (currentUser ? syncStatus : "Login lama aktif. Data hanya tersimpan pada perangkat ini.")
      status.dataset.error = String(Boolean(syncError))
    }
    const signout = panel.querySelector(".acws-panel-signout")
    if (signout) signout.textContent = currentUser ? "Keluar dari akun cloud" : "Masuk dengan email untuk sinkronisasi"
  }
}

async function readCloudData(userId) {
  const { data, error } = await client
    .from("acws_user_data")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function writeCloudData(data) {
  if (!currentUser || !isValidData(data)) return false
  const { error } = await client.from("acws_user_data").upsert({
    user_id: currentUser.id,
    data,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" })
  if (error) {
    setStatus("Gagal menyimpan ke cloud.", "Periksa koneksi internet, lalu coba lagi.")
    return false
  }
  cloudSnapshot = dataSignature(data)
  localSnapshot = dataSignature(readLocalData())
  setStatus(`Tersinkron dengan ${currentUser.email || "akun Anda"}.`)
  return true
}

async function syncAccount(user) {
  if (syncing || stopped) return
  syncing = true
  currentUser = user
  accountReady = false
  render()
  setStatus("Mengambil data akun dari cloud…")
  try {
    const remote = await readCloudData(user.id)
    const local = readLocalData()
    const localSig = dataSignature(local)
    if (remote?.data && isValidData(remote.data) && Object.keys(remote.data).length > 0) {
      const remoteSig = dataSignature(remote.data)
      cloudSnapshot = remoteSig
      if (localSig !== remoteSig) applyLocalData(remote.data, { reload: true })
      localSnapshot = remoteSig
      setStatus(`Tersinkron dengan ${user.email || "akun Anda"}.`)
    } else {
      const decisionKey = `acws_cloud_initial_${user.id}`
      if (localStorage.getItem(decisionKey) === "saved") {
        const seeded = await writeCloudData(local)
        if (!seeded) setStatus("Belum tersinkron. Periksa koneksi dan coba lagi.", "")
      } else if (localStorage.getItem(decisionKey) === "skipped") {
        cloudSnapshot = dataSignature({})
        localSnapshot = localSig
        setStatus("Data perangkat ini belum disalin ke akun cloud.")
      } else if (window.confirm(`Belum ada cadangan untuk ${user.email}. Salin data ACWS pada perangkat ini ke akun tersebut? Data tersimpan di komputer ini tidak akan dihapus.`)) {
        localStorage.setItem(decisionKey, "saved")
        await writeCloudData(local)
      } else {
        localStorage.setItem(decisionKey, "skipped")
        cloudSnapshot = dataSignature({})
        localSnapshot = localSig
        setStatus("Data perangkat ini belum disalin ke akun cloud. Gunakan menu Data & akun untuk ekspor atau coba lagi.")
      }
    }
  } catch (error) {
    setStatus("Data cloud belum dapat dimuat.", "Periksa koneksi internet dan muat ulang halaman. Data perangkat tidak dihapus.")
  } finally {
    syncing = false
    accountReady = true
    render()
  }
}

function schedulePush() {
  if (!currentUser || syncing) return
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(async () => {
    const data = readLocalData()
    const signature = dataSignature(data)
    if (signature === localSnapshot || signature === cloudSnapshot) return
    await writeCloudData(data)
  }, 900)
}

async function pollCloud() {
  if (!currentUser || syncing || stopped || !navigator.onLine) return
  const local = readLocalData()
  const localSig = dataSignature(local)
  if (localSig !== localSnapshot && localSig !== cloudSnapshot) {
    await writeCloudData(local)
    return
  }
  try {
    const remote = await readCloudData(currentUser.id)
    if (!remote?.data || !isValidData(remote.data)) return
    const remoteSig = dataSignature(remote.data)
    if (remoteSig !== cloudSnapshot && remoteSig !== localSig) {
      cloudSnapshot = remoteSig
      applyLocalData(remote.data, { reload: true })
    }
  } catch {
    setStatus("Koneksi cloud terputus sementara. Perubahan lokal tetap tersimpan.", "")
  }
}

function listenForAppDataChanges() {
  const originalSetItem = Storage.prototype.setItem
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value)
    if (this === localStorage && DATA_KEYS.includes(String(key))) schedulePush()
  }
  const originalRemoveItem = Storage.prototype.removeItem
  Storage.prototype.removeItem = function (key) {
    originalRemoveItem.call(this, key)
    if (this === localStorage && DATA_KEYS.includes(String(key))) schedulePush()
  }
  window.addEventListener("storage", (event) => {
    if (DATA_KEYS.includes(event.key || "")) schedulePush()
  })
  localSnapshot = dataSignature(readLocalData())
  pollTimer = window.setInterval(pollCloud, DEFAULT_SYNC_INTERVAL)
  window.addEventListener("online", pollCloud)
}

async function initialize() {
  createStyles()
  makeGate()
  installDataPanel()
  render()
  listenForAppDataChanges()

  try {
    const configResponse = await fetch("/api/config", { cache: "no-store" })
    if (!configResponse.ok) throw new Error("Cloud setup is unavailable")
    const config = await configResponse.json()
    if (!config.url || !config.key) throw new Error("Cloud setup is incomplete")
    client = createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
    const { data: { session } } = await client.auth.getSession()
    if (session?.user) await syncAccount(session.user)
    else if (sessionStorage.getItem("acws_legacy_access") === "true") {
      render()
      setStatus("Login lama aktif. Data hanya tersimpan pada perangkat ini.")
    } else {
      render()
      setStatus("Masuk dengan email untuk mengaktifkan sinkronisasi cloud.")
    }
    client.auth.onAuthStateChange((event, sessionUpdate) => {
      if (event === "SIGNED_OUT") {
        currentUser = null
        render()
        return
      }
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && sessionUpdate?.user) {
        workPromise = workPromise.then(() => syncAccount(sessionUpdate.user))
      }
    })
  } catch {
    client = null
    render()
    setStatus("Layanan akun belum siap. Login lama tetap tersedia.", "Periksa koneksi Supabase dan coba muat ulang halaman.")
  }
}

initialize()

window.addEventListener("pagehide", () => {
  stopped = true
  window.clearInterval(pollTimer)
  window.clearTimeout(debounceTimer)
})

window.acwsBackup = {
  version: 1,
  format: BACKUP_FORMAT,
  keys: [...DATA_KEYS],
  supportedFormats: ["json", "xlsx"],
}
