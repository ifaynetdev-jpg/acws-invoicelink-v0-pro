const { Resend } = require("resend")

const SENDER = "ACWS <no-reply@acws.my.id>"

function respond(res, status, payload) {
  res.setHeader("Cache-Control", "no-store")
  return res.status(status).json(payload)
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST")
    return respond(res, 405, { success: false, error: "Gunakan GET untuk tes Resend atau POST saat sudah login untuk menguji email akun." })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return respond(res, 503, { success: false, error: "RESEND_API_KEY belum tersedia di environment server." })
  }

  const resend = new Resend(apiKey)
  if (req.method === "GET") {
    try {
      const { data, error } = await resend.emails.send({
        from: SENDER,
        to: ["delivered@resend.dev"],
        subject: "ACWS — tes domain email",
        html: "<p>Permintaan email tes ACWS berhasil diterima oleh Resend dari no-reply@acws.my.id.</p>",
      }, { idempotencyKey: "acws-test-email/resend-smoke-test" })

      if (error) {
        return respond(res, 502, { success: false, error: error.message || "Resend gagal menerima email tes." })
      }

      return respond(res, 200, {
        success: true,
        message: "Resend menerima email tes dari no-reply@acws.my.id. delivered@resend.dev adalah alamat simulasi, bukan kotak masuk nyata.",
        data: { id: data?.id },
      })
    } catch {
      return respond(res, 502, { success: false, error: "Tidak dapat terhubung ke Resend untuk tes email." })
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return respond(res, 503, { success: false, error: "Konfigurasi autentikasi server belum tersedia." })
  }

  const authorization = req.headers.authorization || ""
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) {
    return respond(res, 401, { success: false, error: "Silakan login ke akun ACWS terlebih dahulu untuk mengirim email tes." })
  }

  try {
    const userResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    })

    if (!userResponse.ok) {
      return respond(res, 401, { success: false, error: "Sesi login tidak valid atau sudah berakhir. Login kembali lalu coba lagi." })
    }

    const user = await userResponse.json()
    const recipient = typeof user.email === "string" ? user.email.trim() : ""
    if (!user.id || !recipient || !(user.email_confirmed_at || user.confirmed_at)) {
      return respond(res, 403, { success: false, error: "Email tes hanya dapat dikirim ke alamat akun ACWS yang sudah terverifikasi." })
    }

    const idempotencyKey = `acws-test-email/${user.id}/${new Date().toISOString().slice(0, 10)}`
    const { data, error } = await resend.emails.send({
      from: SENDER,
      to: [recipient],
      subject: "ACWS — tes pengiriman email",
      html: "<div style=\"font-family:Arial,sans-serif;line-height:1.6\"><h2>Email tes ACWS berhasil dikirim</h2><p>Pengirim: <strong>no-reply@acws.my.id</strong></p><p>Email ini memverifikasi koneksi aplikasi ke Resend. Email OTP Supabase tetap menggunakan konfigurasi SMTP dan template Auth Supabase.</p></div>",
    }, { idempotencyKey })

    if (error) {
      return respond(res, 502, { success: false, error: error.message || "Resend gagal mengirim email tes." })
    }

    return respond(res, 200, {
      success: true,
      message: `Email tes dikirim ke ${recipient}.`,
      data: { id: data?.id },
    })
  } catch {
    return respond(res, 502, { success: false, error: "Pengiriman gagal. Periksa koneksi Supabase dan konfigurasi Resend." })
  }
}
