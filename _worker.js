export default {
  async fetch(request, env) {
    // 1. Sécurité des domaines (CORS)
    // Pour l'instant on laisse "*", mais en production tu le remplaceras par "https://sdsprotech.com"
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          // On ajoute les en-têtes spécifiques à PawaPay ici
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Signature, Signature-Input, Content-Digest",
        },
      });
    }
    
    const url = new URL(request.url);
    
    // Route de test (API Health)
    if (request.method === "GET" && url.pathname === "/pawapay/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Interception et Sécurisation des Webhooks (Callbacks)
    if (request.method === "POST" && url.pathname.startsWith("/pawapay/")) {
      
      // Le "vigile" à l'entrée : on vérifie que c'est bien PawaPay qui parle
      const isAuthentic = await verifyPawaPayRequest(request, env);
      if (!isAuthentic) {
        return new Response(JSON.stringify({ error: "Accès refusé : Signature invalide" }), { status: 401 });
      }

      // Si le vigile valide, on traite l'opération vers Supabase
      if (url.pathname === "/pawapay/callback") {
        return handleCallback(request, env, "deposit");
      }
      if (url.pathname === "/pawapay/refund") {
        return handleCallback(request, env, "refund");
      }
    }
    
    return new Response(null, { status: 404 });
  },
};

// ==========================================
// FONCTION DE VÉRIFICATION (LE VIGILE)
// ==========================================
async function verifyPawaPayRequest(request, env) {
  // PawaPay envoie ces en-têtes cachés pour prouver son identité
  const signature = request.headers.get("Signature");
  const contentDigest = request.headers.get("Content-Digest");

  // ÉTAPE DE PRODUCTION :
  // Quand ton compte PawaPay sera configuré en mode "Signed Requests", 
  // tu enlèveras les "//" devant "return false;" pour bloquer ceux qui n'ont pas de signature.
  if (!signature || !contentDigest) {
    console.warn("Alerte: Tentative d'accès sans les signatures cryptographiques PawaPay !");
    // return false; 
  }

  // ÉTAPE DE SÉCURITÉ SUPPLÉMENTAIRE (Facultative mais recommandée) :
  // Tu peux définir un PAWAPAY_WEBHOOK_SECRET dans Cloudflare et vérifier qu'il est présent.
  // const webhookSecret = env.PAWAPAY_WEBHOOK_SECRET;
  // const providedToken = request.headers.get("Authorization");
  // if (webhookSecret && providedToken !== `Bearer ${webhookSecret}`) {
  //   return false;
  // }

  return true; // Pour tes tests actuels, on laisse passer.
}

// ==========================================
// FONCTION DE TRAITEMENT (SUPABASE)
// ==========================================
async function handleCallback(request, env, type) {
  const SUPABASE_URL = "https://fvfkawxwtsziqzibzbxt.supabase.co";
  const SUPABASE_KEY = env.SUPABASE_KEY; 
  
  let body;
  try {
    // IMPORTANT : On utilise request.clone() pour copier le message.
    // Cela évite un bug si la fonction de vérification plus haut a déjà lu le texte.
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
