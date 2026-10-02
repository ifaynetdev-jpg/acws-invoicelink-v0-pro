module.exports = function config(_request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0")
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Content-Type", "application/json; charset=utf-8")

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    response.statusCode = 503
    response.end(JSON.stringify({ error: "Cloud authentication is not configured." }))
    return
  }

  response.statusCode = 200
  response.end(JSON.stringify({ url, key }))
}
