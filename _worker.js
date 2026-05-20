export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/pawapay/callback") {
      return handleCallback(request, "deposit");
    }
    if (request.method === "POST" && url.pathname === "/pawapay/refund") {
      return handleCallback(request, "refund");
    }
    if (request.method === "GET" && url.pathname === "/pawapay/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 404 });
  },
};

async function handleCallback(request, type) {
  const SUPABASE_URL = "https://fvfkawxwtsziqzibzbxt.supabase.co";
  const SUPABASE_KEY = "env.SUPABASE_KEY";
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const payment = {
    pawapay_id: body.depositId || body.refundId || null,
    type: type,
    status: body.status || "UNKNOWN",
    amount: body.amount ? parseFloat(body.amount) : null,
    currency: body.currency || "XOF",
    phone: body.payer?.address?.value || body.payee?.address?.value || null,
    operator: body.correspondent || null,
    description: body.statementDescription || null,
    raw: JSON.stringify(body),
    created_at: new Date().toISOString(),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pawapay_payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(payment),
  });
  if (!res.ok) {
    return new Response(JSON.stringify({ error: "DB error" }), { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
