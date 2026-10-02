export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: "ACWS Webhook Ready Bos!",
      endpoint: "/api/lynk-webhook",
      method: "POST",
      active: "30 Hari"
    });
  }
  const wa = req.body?.customer_phone || req.body?.phone || "628122038617";
  const order_id = req.body?.order_id || Date.now();
  return res.status(200).json({
    success: true,
    wa: wa,
    redirect: "https://acws-invoicelink-v0-pro.vercel.app/?lynk_status=success&wa=" + wa + "&order_id=" + order_id
  });
}

