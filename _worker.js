export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CORS STRICT
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "https://sdsprotech.com",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, Signature, Content-Digest",
        },
      });
    }

    // =========================
    // HEALTH CHECK
    // =========================
    if (request.method === "GET" && url.pathname === "/pawapay/health") {
      return new Response(
        JSON.stringify({ status: "ok", service: "tanor_pay" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // =========================
    // ROUTES WHITELIST
    // =========================
    const routes = ["/pawapay/callback", "/pawapay/refund"];

    if (request.method === "POST" && routes.includes(url.pathname)) {
      const rawBody = await request.text();

      const ok = await verifySignature(request, env, rawBody);
      if (!ok) {
        console.error("[SECURITY] invalid signature");
        return new Response("unauthorized", { status: 401 });
      }

      const type = url.pathname.includes("refund") ? "refund" : "deposit";

      return handleCallback(rawBody, env, type);
    }

    return new Response("not found", { status: 404 });
  },
};

// =========================
// SIGNATURE + ANTI REPLAY
// =========================
async function verifySignature(request, env, rawBody) {
  const secret = env.PAWAPAY_WEBHOOK_SECRET;
  const signatureHeader = request.headers.get("Signature");

  if (!secret || !signatureHeader) return false;

  let timestamp;
  let providedSig = signatureHeader;

  // format: t=xxx,v1=yyy
  if (signatureHeader.includes("t=") && signatureHeader.includes("v1=")) {
    const t = signatureHeader.match(/t=(\d+)/)?.[1];
    const v1 = signatureHeader.match(/v1=([a-f0-9]+)/i)?.[1];

    if (!t || !v1) return false;

    timestamp = Number(t);
    providedSig = v1;

    // anti replay 5 min
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      console.warn("[SECURITY] replay attack blocked");
      return false;
    }
  }

  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(rawBody)
  );

  const expected = [...new Uint8Array(sigBuf)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, providedSig);
}

// =========================
// TIMING SAFE COMPARE
// =========================
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

// =========================
// CALLBACK HANDLER
// =========================
async function handleCallback(rawBody, env, type) {
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_KEY;

  const body = JSON.parse(rawBody);

  const pawapayId = body.depositId || body.refundId;
  if (!pawapayId) {
    return new Response("missing id", { status: 400 });
  }

  // =========================
  // ID EMPOTENCE CHECK (DB)
  // =========================
  const exists = await fetch(
    `${SUPABASE_URL}/rest/v1/pawapay_payments?pawapay_id=eq.${pawapayId}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  const already = await exists.json();

  if (already.length > 0) {
    return new Response(
      JSON.stringify({ ok: true, status: "duplicate_ignored" }),
      { status: 200 }
    );
  }

  // =========================
  // INSERT PAYMENT
  // =========================
  const payment = {
    pawapay_id: pawapayId,
    type,
    status: body.status || "UNKNOWN",
    amount: body.amount ? Number(body.amount) : null,
    currency: body.currency || "XOF",
    phone:
      body?.payer?.address?.value ||
      body?.payee?.address?.value ||
      null,
    operator: body.correspondent || null,
    raw: rawBody,
    created_at: new Date().toISOString(),
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pawapay_payments`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payment),
    }
  );

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: "db error" }),
      { status: 500 }
    );
  }

  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200 }
  );
}
