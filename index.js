/* =============================================
   index.js — login e lista de inventários
   ============================================= */
const $ = (id) => document.getElementById(id);

function mostrar(qual) {
  $("tela-login").classList.toggle("oculto", qual !== "login");
  const hub = $("tela-hub");
  hub.classList.remove("oculto");        // .oculto usa !important e venceria o display abaixo
  hub.style.display = qual === "hub" ? "flex" : "none";
  $("btn-sair").classList.toggle("oculto", qual !== "hub");
}

/* ---------- login ---------- */
// O gerente escolhe a loja e digita a senha.
// O e-mail é só o identificador interno do Supabase — ele nunca precisa vê-lo.
const emailDaLoja = (codigo) => `loja${codigo}@rotta400.app`;
let modoAuditor = false;

async function carregarLojas() {
  const sel = $("loja");
  const guardadas = JSON.parse(localStorage.getItem("r400_lojas") || "null");
  const desenhar = (lojas) => {
    const ultima = localStorage.getItem("r400_ultima_loja") || "";
    sel.innerHTML = `<option value="">Selecione a loja</option>` +
      lojas.map((l) => `<option value="${l.codigo}"${l.codigo === ultima ? " selected" : ""}>${l.nome}</option>`).join("");
  };
  if (guardadas?.length) desenhar(guardadas);

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/loja?select=codigo,nome&order=codigo`,
      { headers: { apikey: SUPA_KEY } });
    const lojas = await r.json();
    if (Array.isArray(lojas) && lojas.length) {
      localStorage.setItem("r400_lojas", JSON.stringify(lojas));
      desenhar(lojas);
    } else if (!guardadas?.length) {
      sel.innerHTML = `<option value="">nenhuma loja cadastrada</option>`;
    }
  } catch {
    if (!guardadas?.length) sel.innerHTML = `<option value="">sem conexão</option>`;
  }
}

function trocarModo(e) {
  e?.preventDefault();
  modoAuditor = !modoAuditor;
  $("modo-loja").classList.toggle("oculto", modoAuditor);
  $("modo-auditor").classList.toggle("oculto", !modoAuditor);
  $("trocar-modo").textContent = modoAuditor ? "Sou gerente de loja" : "Sou o auditor";
  ($(modoAuditor ? "email" : "loja")).focus();
}

async function fazerLogin() {
  const b = $("btn-entrar");
  const erro = $("erro-login");
  erro.classList.add("oculto");

  let email;
  if (modoAuditor) {
    email = $("email").value.trim();
    if (!email) { erro.textContent = "Informe o e-mail."; erro.classList.remove("oculto"); return; }
  } else {
    const codigo = $("loja").value;
    if (!codigo) { erro.textContent = "Escolha a sua loja."; erro.classList.remove("oculto"); return; }
    email = emailDaLoja(codigo);
    localStorage.setItem("r400_ultima_loja", codigo);
  }

  b.disabled = true; b.textContent = "Entrando…";
  try {
    await entrar(email, $("senha").value);
    await iniciar();
  } catch (e) {
    erro.textContent = modoAuditor ? e.message : "Senha incorreta para esta loja.";
    erro.classList.remove("oculto");
  } finally {
    b.disabled = false; b.textContent = "Entrar";
  }
}

$("btn-entrar").addEventListener("click", fazerLogin);
$("trocar-modo").addEventListener("click", trocarModo);
["senha", "email"].forEach((id) =>
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") fazerLogin(); }));
$("loja").addEventListener("keydown", (e) => { if (e.key === "Enter") $("senha").focus(); });
$("btn-sair").addEventListener("click", sair);
$("btn-novo").addEventListener("click", () => { location.href = "importar.html"; });

/* ---------- hub ---------- */
async function iniciar() {
  if (!sessao()) { mostrar("login"); carregarLojas(); return; }
  mostrar("hub");

  let p = perfil();
  try { p = (await carregarPerfil()) || p; } catch {}

  $("sub").textContent = p?.loja?.nome || (p?.papel === "auditor" ? "Auditor" : "sem loja");
  $("btn-cadastro").classList.toggle("oculto", p?.papel !== "auditor");
  const semLoja = !p?.loja_id && p?.papel !== "auditor";
  $("sem-perfil").classList.toggle("oculto", !semLoja);
  $("btn-novo").disabled = semLoja;

  carregarCadastroInfo();
  carregarLotes();
}

async function carregarCadastroInfo() {
  try {
    const c = await api("cadastro_carga?select=carregado_em,linhas&order=carregado_em.desc&limit=1");
    $("info-cadastro").textContent = c?.length
      ? `${numeroBR(c[0].linhas)} códigos · atualizado em ${dataHoraBR(c[0].carregado_em)}`
      : "Nenhum cadastro carregado ainda — avise o auditor.";
  } catch { $("info-cadastro").textContent = "não foi possível verificar"; }
}

async function carregarLotes() {
  const alvo = $("lista-lotes");
  alvo.innerHTML = `<p class="fraco">carregando…</p>`;
  try {
    const lotes = await api(
      "lote?select=id,nome,status,retrato_em,criado_em,fechado_em,linhas_declaradas,loja(nome)" +
      "&order=criado_em.desc&limit=40");
    if (!lotes.length) {
      alvo.innerHTML = `<p class="fraco">Nenhum inventário ainda. Toque em “Novo inventário”.</p>`;
      return;
    }
    alvo.innerHTML = "";
    for (const l of lotes) {
      const fechado = l.status === "fechado";
      const d = document.createElement("div");
      d.className = "caixa";
      d.style.gap = ".55rem";
      d.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:.6rem">
          <div style="flex:1;min-width:0">
            <h3>${l.nome}</h3>
            <div class="fraco">${l.linhas_declaradas ?? "?"} produtos ·
              retrato ${dataHoraBR(l.retrato_em)}</div>
          </div>
          <span class="selo ${fechado ? "selo--cinza" : "selo--sobra"}">
            ${fechado ? "Fechado" : "Aberto"}</span>
        </div>
        <div class="linha-botoes">
          ${fechado ? "" : `<button class="btn" data-contar="${l.id}">Contar</button>`}
          <button class="btn btn--2" data-div="${l.id}">
            ${fechado ? "Ver divergências" : "Fechar e conferir"}</button>
        </div>`;
      alvo.appendChild(d);
    }
    alvo.querySelectorAll("[data-contar]").forEach((b) =>
      b.addEventListener("click", () => {
        sessionStorage.setItem("r400_lote", b.dataset.contar);
        location.href = "contar.html";
      }));
    alvo.querySelectorAll("[data-div]").forEach((b) =>
      b.addEventListener("click", () => {
        sessionStorage.setItem("r400_lote", b.dataset.div);
        location.href = "divergencias.html";
      }));
  } catch (e) {
    alvo.innerHTML = `<div class="nota nota--erro">Não foi possível carregar: ${e.message}</div>`;
  }
}

iniciar();
