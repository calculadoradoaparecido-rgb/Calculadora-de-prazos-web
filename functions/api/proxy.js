const HOSTS = new Set(["djea-con.tjce.jus.br", "www.tjce.jus.br", "tjce.jus.br"]);
const MAX_BODY = 1_000_000;

export async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const raw = incoming.searchParams.get("url");
  if (!raw || raw.length > 4096) return new Response("Parâmetro url inválido.", { status: 400 });

  let target;
  try { target = new URL(raw); } catch { return new Response("URL inválida.", { status: 400 }); }
  if (target.protocol !== "https:" || !HOSTS.has(target.hostname) || target.username || target.password || target.port) {
    return new Response("Destino não permitido.", { status: 403 });
  }
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
    return new Response("Método não permitido.", { status: 405, headers: { Allow: "GET, HEAD, POST" } });
  }

  let body;
  if (request.method === "POST") {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return new Response("Corpo muito grande.", { status: 413 });
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) return new Response("Corpo muito grande.", { status: 413 });
  }
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType && request.method === "POST") headers.set("content-type", contentType);
  headers.set("user-agent", "Mozilla/5.0 (compatible; PrazosTJCE/1.0)");

  try {
    const upstream = await fetch(target.href, { method: request.method, headers, body, redirect: "follow" });
    const outHeaders = new Headers();
    outHeaders.set("content-type", upstream.headers.get("content-type") || "text/plain; charset=utf-8");
    outHeaders.set("cache-control", "no-store");
    outHeaders.set("x-content-type-options", "nosniff");
    // Não encaminha cookies, cabeçalhos de autenticação ou cabeçalhos de segurança do servidor remoto.
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (error) {
    return new Response(`Falha ao consultar o serviço oficial: ${String(error?.message || error)}`, { status: 502 });
  }
}
