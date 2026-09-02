// AJDAS — Worker : gère l'espace administrateur et le contenu dynamique
// (projets, documents, rapports, galerie). Les pages statiques (public/) sont
// servies automatiquement par le binding "assets" défini dans wrangler.toml.

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function uid() {
  return crypto.randomUUID();
}

function cleanTitleFromFilename(name) {
  const base = (name || "fichier").replace(/\.[^/.]+$/, "");
  return base.replace(/[-_]+/g, " ").trim() || "Fichier";
}

// --- Code d'accès admin, stocké en base (modifiable sans redéploiement) ---

async function getAdminCode(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_code'").first();
  return row ? row.value : "1234";
}

async function setAdminCode(env, code) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('admin_code', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(code).run();
}

// --- Jeton de session signé (pas besoin de table de sessions) ---

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function makeToken(secret) {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${expires}`;
  const sig = await sign(payload, secret);
  return `${payload}.${sig}`;
}

async function verifyToken(token, secret) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = await sign(payload, secret);
  if (expected !== sig) return false;
  const expires = parseInt(payload, 10);
  if (Number.isNaN(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  return true;
}

async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return verifyToken(token, env.SESSION_SECRET);
}

// 'project' accepte 0 ou 1 fichier. 'image', 'document', 'report' acceptent
// un ou plusieurs fichiers (envoi groupé depuis l'espace admin).
const ALLOWED_TYPES = ["project", "document", "image", "report"];
const MULTI_FILE_TYPES = ["image", "document", "report"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // --- Connexion admin (code stocké en base, modifiable) ---
      if (pathname === "/api/login" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const code = (body.code || "").toString().trim();
        const adminCode = await getAdminCode(env);
        if (!code || code !== adminCode) {
          return json({ error: "Code incorrect." }, 401);
        }
        const token = await makeToken(env.SESSION_SECRET);
        return json({ token });
      }

      // --- Vérifier une session existante (au chargement de l'admin) ---
      if (pathname === "/api/session" && request.method === "GET") {
        const ok = await requireAuth(request, env);
        return json({ valid: ok });
      }

      // --- Changer le code admin (protégé) ---
      if (pathname === "/api/settings/code" && request.method === "POST") {
        if (!(await requireAuth(request, env))) return json({ error: "Non autorisé." }, 401);
        const body = await request.json().catch(() => ({}));
        const current = (body.current || "").toString().trim();
        const next = (body.next || "").toString().trim();
        const adminCode = await getAdminCode(env);
        if (current !== adminCode) return json({ error: "Le code actuel est incorrect." }, 401);
        if (!/^.{4,}$/.test(next)) return json({ error: "Le nouveau code doit contenir au moins 4 caractères." }, 400);
        await setAdminCode(env, next);
        return json({ updated: true });
      }

      // --- Liste du contenu (public) ---
      if (pathname === "/api/items" && request.method === "GET") {
        const type = url.searchParams.get("type");
        let query = "SELECT id, type, title, description, filename, r2_key, mime_type, downloadable, group_id, created_at FROM items";
        const params = [];
        if (type && ALLOWED_TYPES.includes(type)) {
          query += " WHERE type = ?";
          params.push(type);
        }
        query += " ORDER BY created_at DESC";
        const { results } = await env.DB.prepare(query).bind(...params).all();
        return json({ items: results });
      }

      // --- Ajouter un ou plusieurs éléments en une fois (protégé) ---
      if (pathname === "/api/items" && request.method === "POST") {
        if (!(await requireAuth(request, env))) return json({ error: "Non autorisé." }, 401);

        const form = await request.formData();
        const type = form.get("type");
        const commonTitle = (form.get("title") || "").toString().trim();
        const description = (form.get("description") || "").toString().trim();
        const downloadable = form.get("downloadable") === "0" ? 0 : 1;

        if (!ALLOWED_TYPES.includes(type)) return json({ error: "Type invalide." }, 400);

        const allFiles = form.getAll("file").filter(f => f && typeof f !== "string" && f.size > 0);

        if (!MULTI_FILE_TYPES.includes(type)) {
          // 'project' : un titre obligatoire, un fichier optionnel
          if (!commonTitle) return json({ error: "Le titre est obligatoire." }, 400);
          const file = allFiles[0] || null;
          const id = uid();
          let r2_key = null, filename = null, mime_type = null;
          if (file) {
            filename = file.name;
            mime_type = file.type || "application/octet-stream";
            r2_key = `${type}/${id}-${filename}`;
            await env.FILES.put(r2_key, await file.arrayBuffer(), { httpMetadata: { contentType: mime_type } });
          }
          await env.DB.prepare(
            `INSERT INTO items (id, type, title, description, filename, r2_key, mime_type, downloadable, group_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
          ).bind(id, type, commonTitle, description, filename, r2_key, mime_type, downloadable, Date.now()).run();
          return json({ items: [{ id, type, title: commonTitle, description, filename, r2_key, mime_type, downloadable, group_id: null, created_at: Date.now() }] }, 201);
        }

        // 'image' / 'document' / 'report' : un ou plusieurs fichiers requis
        if (allFiles.length === 0) return json({ error: "Sélectionne au moins un fichier." }, 400);

        // Fichiers envoyés ensemble en une seule fois : ils partagent un group_id
        // pour rester affichés dans un même bloc sur le site.
        const group_id = allFiles.length > 1 ? uid() : null;

        const created = [];
        for (const file of allFiles) {
          const id = uid();
          const filename = file.name;
          const mime_type = file.type || "application/octet-stream";
          const r2_key = `${type}/${id}-${filename}`;
          await env.FILES.put(r2_key, await file.arrayBuffer(), { httpMetadata: { contentType: mime_type } });

          // Le titre/la description saisis s'appliquent à tout le lot ; si aucun
          // titre n'est donné, chaque fichier reçoit son propre titre déduit du nom.
          const title = commonTitle || cleanTitleFromFilename(filename);

          const created_at = Date.now();
          await env.DB.prepare(
            `INSERT INTO items (id, type, title, description, filename, r2_key, mime_type, downloadable, group_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(id, type, title, description, filename, r2_key, mime_type, downloadable, group_id, created_at).run();
          created.push({ id, type, title, description, filename, r2_key, mime_type, downloadable, group_id, created_at });
        }
        return json({ items: created }, 201);
      }

      // --- Supprimer un élément (protégé) ---
      const deleteMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
      if (deleteMatch && request.method === "DELETE") {
        if (!(await requireAuth(request, env))) return json({ error: "Non autorisé." }, 401);
        const id = deleteMatch[1];
        const row = await env.DB.prepare("SELECT r2_key FROM items WHERE id = ?").bind(id).first();
        if (row && row.r2_key) await env.FILES.delete(row.r2_key);
        await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
        return json({ deleted: true });
      }

      // --- Servir un fichier stocké dans R2 (public, lecture seule) ---
      const fileMatch = pathname.match(/^\/api\/files\/(.+)$/);
      if (fileMatch && request.method === "GET") {
        const key = decodeURIComponent(fileMatch[1]);
        const obj = await env.FILES.get(key);
        if (!obj) return new Response("Introuvable", { status: 404 });
        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set("etag", obj.httpEtag);
        headers.set("cache-control", "public, max-age=31536000, immutable");
        return new Response(obj.body, { headers });
      }

      // Toute autre route /api/* inconnue
      if (pathname.startsWith("/api/")) return json({ error: "Route inconnue." }, 404);

      // Fallback : laisser les assets statiques gérer (ne devrait pas être atteint
      // car run_worker_first ne cible que /api/*)
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: "Erreur serveur.", detail: String(err) }, 500);
    }
  },
};
