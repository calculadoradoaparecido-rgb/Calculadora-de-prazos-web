// Proxy restrito a fontes públicas específicas do TJCE/DJEA.
// Não encaminha cookies, autenticação do usuário nem permite destinos arbitrários.
const HOSTS = new Set(["djea-con.tjce.jus.br", "www.tjce.jus.br", "tjce.jus.br"]);
const MAX_BODY = 1_000_000;
const MAX_RESPONSE = 8 * 1024 * 1024;
const REDIRECTS_MAX = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const AJAX_ACTION = /(?:calend|calendar|event|evento|feriad)/i;

function destinoBaseValido(url) {
  return url instanceof URL && url.protocol === "https:" && HOSTS.has(url.hostname) &&
    !url.username && !url.password && !url.port;
}

function acaoAjax(url, bodyText = "") {
  const queryAction = url.searchParams.get("action") || "";
  let bodyAction = "";
  try { bodyAction = new URLSearchParams(bodyText).get("action") || ""; } catch {}
  return queryAction || bodyAction;
}

function destinoPermitido(url, method, bodyText = "") {
  if (!destinoBaseValido(url)) return false;
  const path = url.pathname;
  const host = url.hostname;
  const m = method.toUpperCase();

  if (host === "djea-con.tjce.jus.br") {
    if (!/^\/materias(?:\/\d+)?\/?$/.test(path)) return false;
    if (m === "GET" || m === "HEAD") return true;
    return m === "POST" && /^\/materias\/?$/.test(path);
  }

  if (m !== "GET" && m !== "HEAD" && m !== "POST") return false;
  if ((m === "GET" || m === "HEAD") && /^\/calendario\/?$/.test(path)) return true;
  if ((m === "GET" || m === "HEAD") && path.startsWith("/wp-content/") && /\.m?js$/i.test(path)) return true;
  if ((m === "GET" || m === "HEAD") && path.startsWith("/wp-json/") && AJAX_ACTION.test(path)) return true;
  if ((m === "GET" || m === "HEAD") && AJAX_ACTION.test(path)) return true;
  if (path === "/wp-admin/admin-ajax.php" && AJAX_ACTION.test(acaoAjax(url, bodyText))) return true;
  return false;
}

function resposta(texto, status, extras = {}) {
  return new Response(texto, { status, headers: {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extras
  }});
}

export async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  // Impede uso direto a partir de outras origens em navegadores comuns.
  if (origin && origin !== incoming.origin) return resposta("Origem não permitida.", 403);
  if (fetchSite === "cross-site") return resposta("Requisição entre sites não permitida.", 403);
  if (method === "POST" && origin !== incoming.origin) return resposta("POST exige origem do próprio site.", 403);

  if (!new Set(["GET", "HEAD", "POST"]).has(method)) {
    return resposta("Método não permitido.", 405, { Allow: "GET, HEAD, POST" });
  }
  const raw = incoming.searchParams.get("url");
  if (!raw || raw.length > 4096) return resposta("Parâmetro url inválido.", 400);

  let target;
  try { target = new URL(raw); } catch { return resposta("URL inválida.", 400); }

  let body;
  let bodyText = "";
  if (method === "POST") {
    const ctype = request.headers.get("content-type") || "";
    if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(ctype)) {
      return resposta("Tipo de conteúdo não permitido para POST.", 415);
    }
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return resposta("Corpo muito grande.", 413);
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) return resposta("Corpo muito grande.", 413);
    bodyText = new TextDecoder().decode(body);
  }

  if (!destinoPermitido(target, method, bodyText)) return resposta("Destino ou caminho não permitido.", 403);

  const headers = new Headers({ "user-agent": "PrazosTJCE/2.17.6 (consulta pública; contato via responsável pelo site)" });
  if (method === "POST") headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");

  try {
    let current = target;
    let currentMethod = method;
    let currentBody = body;
    let currentBodyText = bodyText;
    let upstream;

    for (let hop = 0; hop <= REDIRECTS_MAX; hop++) {
      if (!destinoPermitido(current, currentMethod, currentBodyText)) {
        return resposta("Destino de redirecionamento não permitido.", 403);
      }
      upstream = await fetch(current.href, {
        method: currentMethod,
        headers,
        body: currentMethod === "POST" ? currentBody : undefined,
        redirect: "manual"
      });
      if (!REDIRECT_STATUS.has(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location || hop === REDIRECTS_MAX) return resposta("Redirecionamento não permitido ou excessivo.", 502);
      if (currentMethod === "POST") return resposta("Redirecionamento POST bloqueado por segurança.", 502);
      let next;
      try { next = new URL(location, current); } catch { return resposta("Destino de redirecionamento inválido.", 502); }
      if (!destinoPermitido(next, currentMethod, "")) return resposta("Destino de redirecionamento fora da lista autorizada.", 403);
      current = next;
      if (upstream.status === 303) currentMethod = "GET";
    }

    if (!upstream) return resposta("Não foi possível consultar a fonte oficial.", 502);
    const len = Number(upstream.headers.get("content-length") || 0);
    if (len > MAX_RESPONSE) return resposta("Resposta da fonte oficial excede o limite permitido.", 502);
    const semCorpo = method === "HEAD" || [204, 205, 304].includes(upstream.status);
    const bytes = semCorpo ? null : await upstream.arrayBuffer();
    if (bytes && bytes.byteLength > MAX_RESPONSE) return resposta("Resposta da fonte oficial excede o limite permitido.", 502);

    const outHeaders = new Headers();
    outHeaders.set("content-type", upstream.headers.get("content-type") || "text/plain; charset=utf-8");
    outHeaders.set("cache-control", "no-store");
    outHeaders.set("x-content-type-options", "nosniff");
    outHeaders.set("referrer-policy", "no-referrer");
    return new Response(bytes, { status: upstream.status, headers: outHeaders });
  } catch (error) {
    return resposta(`Falha ao consultar a fonte oficial: ${String(error?.message || error).slice(0, 240)}`, 502);
  }
}
