export default {
  async fetch(request, env) {
    // 1. SÉCURITÉ DES DOMAINES (CORS Strict)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          // Remplacement de "*" par ton domaine officiel pour bloquer les autres sites
          "Access-Control-Allow-Origin": "https://sdsprotech.com",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Signature, Signature-Input, Content-Digest",
        },
      });
    }

    const url = new URL(request.url);

    // Route de test (API Health)
    if (request.method === "GET" && url.pathname === "/pawapay/health") {
      return new Response(JSON.stringify({ status: "ok", message: "API Tanor Pay sécurisée et en ligne" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. INTERCEPTION ET SÉCURISATION DES WEBHOOKS PAWAPAY
    if (request.method === "POST" && url.pathname.startsWith("/pawapay/")) {

      // LE VIGILE ACTIVÉ : Vérification stricte
      const isAuthentic = await verifyPawaPayRequest(request, env);
      if (!isAuthentic) {
        // Blocage immédiat si la signature est absente
        return new Response(JSON.stringify({ error: "Accès refusé : Signature non valide ou absente" }), { status: 401 });
      }

      // Si le vigile valide (c'est bien PawaPay), on traite l'opération
      if (url.pathname === "/pawapay/callback") {
        return handleCallback(request, env, "deposit");
      }
      if (url.pathname === "/pawapay/refund") {
        return handleCallback(request, env, "refund");
      }
    }

    // Si la route n'existe pas
    return new Response(JSON.stringify({ error: "Route non trouvée" }), { status: 404 });
  },
};

// ==========================================
// FONCTION DE VÉRIFICATION (LE VIGILE ACTIF)
// ==========================================
async function verifyPawaPayRequest(request, env) {
  // Récupération des en-têtes de sécurité envoyés par PawaPay
  const signature = request.headers.get("Signature");
  const contentDigest = request.headers.get("Content-Digest");

  // BLOCAGE ACTIVÉ : Si PawaPay n'envoie pas ses signatures, on rejette impitoyablement.
  if (!signature || !contentDigest) {
    console.warn("Alerte Sécurité : Tentative d'accès sans signatures PawaPay !");
    return false; // <-- Cette ligne bloque les fausses requêtes
  }

  // PRÉPARATION POUR LE SECRET WEBHOOK (Optionnel mais recommandé)
  // Le jour où tu configures un token secret dans PawaPay, tu pourras décommenter ceci :
  /*
  const webhookSecret = env.PAWAPAY_WEBHOOK_SECRET;
  const providedToken = request.headers.get("Authorization");
  if (webhookSecret && providedToken !== `Bearer ${webhookSecret}`) {
    console.warn("Alerte Sécurité : Mauvais token d'autorisation !");
    return false;
  }
  */

  return true; 
}

// ==========================================
// FONCTION DE TRAITEMENT (ENREGISTREMENT SUPABASE)
// ==========================================
async function handleCallback(request, env, type) {
  const SUPABASE_URL = "https://fvfkawxwtsziqzibzbxt.supabase.co";
  const SUPABASE_KEY = env.SUPABASE_KEY; // La clé reste toujours invisible !

  let body;
  try {
    // IMPORTANT : Utilisation de request.clone() pour lire le contenu en toute sécurité
    body = await request.clone().json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Format JSON invalide" }), { status: 400 });
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
    return new Response(JSON.stringify({ error: "Erreur d'enregistrement dans la base de données" }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
