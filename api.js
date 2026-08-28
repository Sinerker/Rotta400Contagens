/* =============================================
   api.js — login e conversa com o banco
   =============================================
   Sem biblioteca externa: só fetch. Mantém o app
   pequeno e faz ele abrir offline sem depender de CDN.
   ============================================= */

const SESSAO_KEY = "r400_sessao";

function sessao() {
  try { return JSON.parse(localStorage.getItem(SESSAO_KEY) || "null"); } catch { return null; }
}
function gravarSessao(s) {
  if (s) localStorage.setItem(SESSAO_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSAO_KEY);
}

async function entrar(email, senha) {
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password: senha }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.msg || "E-mail ou senha inválidos");
  gravarSessao({
    token: j.access_token,
    refresh: j.refresh_token,
    expira: Date.now() + (j.expires_in - 60) * 1000,
    email: j.user?.email || email,
  });
  await carregarPerfil();
  return sessao();
}

async function renovar() {
  const s = sessao();
  if (!s?.refresh) throw new Error("sem sessão");
  const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh }),
  });
  const j = await r.json();
  if (!r.ok) { gravarSessao(null); throw new Error("sessão expirada"); }
  gravarSessao({ ...s, token: j.access_token, refresh: j.refresh_token,
                 expira: Date.now() + (j.expires_in - 60) * 1000 });
}

async function token() {
  const s = sessao();
  if (!s) throw new Error("não logado");
  if (Date.now() > s.expira) await renovar();
  return sessao().token;
}

function sair() {
  gravarSessao(null);
  localStorage.removeItem("r400_perfil");
  location.href = "index.html";
}

/* ---- chamada genérica ---- */
async function api(caminho, opcoes = {}) {
  const t = await token();
  const r = await fetch(`${SUPA_URL}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      ...(opcoes.headers || {}),
    },
  });
  if (!r.ok) {
    let msg = `erro ${r.status}`;
    try { const j = await r.json(); msg = j.message || j.hint || msg; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

const rpc = (nome, args = {}) =>
  api(`rpc/${nome}`, { method: "POST", body: JSON.stringify(args) });

/* ---- perfil (loja e papel do usuário) ---- */
async function carregarPerfil() {
  const p = await api("perfil?select=papel,loja_id,loja(codigo,nome)");
  const perfil = p?.[0] || null;
  if (perfil) localStorage.setItem("r400_perfil", JSON.stringify(perfil));
  return perfil;
}
function perfil() {
  try { return JSON.parse(localStorage.getItem("r400_perfil") || "null"); } catch { return null; }
}

/* ---- guarda de página ---- */
function exigirLogin() {
  if (!sessao()) { location.href = "index.html"; return false; }
  return true;
}

/* ---- utilidades ---- */
function numeroBR(v) {
  return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
function dataHoraBR(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR",
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function aviso(msg, tipo = "erro") {
  document.querySelector(".toast")?.remove();
  const d = document.createElement("div");
  d.className = `toast toast--${tipo}`;
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.classList.add("saindo"), 2600);
  setTimeout(() => d.remove(), 3000);
}
