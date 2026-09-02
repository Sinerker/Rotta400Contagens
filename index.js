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
          ${fechado ? `<button class="btn btn--2" data-excluir="${l.id}"
             style="flex:0 0 auto;min-width:0;color:var(--falta)" title="Excluir inventário">
             <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M5 6l1-3h12l1 3"/></svg>
           </button>` : ""}
        </div>`;
      alvo.appendChild(d);
    }
    alvo.querySelectorAll("[data-contar]").forEach((b) =>
      b.addEventListener("click", () => {
        sessionStorage.setItem("r400_lote", b.dataset.contar);
        location.href = "contar.html";
      }));
    alvo.querySelectorAll("[data-excluir]").forEach((b) =>
      b.addEventListener("click", () => pedirExclusao(b.dataset.excluir)));
    alvo.querySelectorAll("[data-div]").forEach((b) =>
      b.addEventListener("click", () => {
        sessionStorage.setItem("r400_lote", b.dataset.div);
        location.href = "divergencias.html";
      }));
  } catch (e) {
    alvo.innerHTML = `<div class="nota nota--erro">Não foi possível carregar: ${e.message}</div>`;
  }
}

/* ---------- excluir inventário ---------- */
/* Duas confirmações de propósito. A primeira explica o que some,
   a segunda existe só para quebrar o piloto automático: os botões
   trocam de lado e o de excluir só libera depois de 3 segundos. */
let loteParaExcluir = null;
let contagemRegressiva = null;

const fechaModais = () => {
  $("modal-excluir-1").classList.remove("aberto");
  $("modal-excluir-2").classList.remove("aberto");
  if (contagemRegressiva) { clearInterval(contagemRegressiva); contagemRegressiva = null; }
  loteParaExcluir = null;
};

function cartaoDoLote(r) {
  return `<div class="item">
    <span class="item-desc">${r.nome}</span>
    <span class="item-info">${r.loja || ""}${r.fechado_em ? " · fechado em " + dataHoraBR(r.fechado_em) : ""}</span>
    <span class="fraco" style="margin-top:.3rem">
      Vão sumir <b>${numeroBR(r.produtos)} produtos</b> e
      <b>${numeroBR(r.contagens)} lançamento${r.contagens === 1 ? "" : "s"}</b> de contagem.</span>
  </div>`;
}

async function pedirExclusao(id) {
  try {
    const [r] = await rpc("resumo_para_excluir", { p_lote: id });
    if (!r) { aviso("Inventário não encontrado"); return; }
    loteParaExcluir = { id, ...r };
    $("excluir-alvo").innerHTML = cartaoDoLote(r);
    $("excluir-alvo-2").innerHTML = cartaoDoLote(r);
    $("motivo-exclusao").value = "";
    $("excluir-1-sim").disabled = true;
    $("modal-excluir-1").classList.add("aberto");
  } catch (e) { aviso(e.message); }
}

function abrirConfirmacaoFinal() {
  if (!loteParaExcluir) return;
  loteParaExcluir.motivo = $("motivo-exclusao").value;
  if (!loteParaExcluir.motivo) { aviso("Escolha o motivo da exclusão"); return; }
  $("modal-excluir-1").classList.remove("aberto");
  $("modal-excluir-2").classList.add("aberto");

  const b = $("excluir-2-sim");
  let resta = 3;
  b.disabled = true;
  b.textContent = `Aguarde… ${resta}`;
  if (contagemRegressiva) clearInterval(contagemRegressiva);
  contagemRegressiva = setInterval(() => {
    resta -= 1;
    if (resta > 0) { b.textContent = `Aguarde… ${resta}`; return; }
    clearInterval(contagemRegressiva); contagemRegressiva = null;
    b.disabled = false;
    b.textContent = "Sim, excluir para sempre";
  }, 1000);
}

async function excluirDeVez() {
  if (!loteParaExcluir) return;
  const b = $("excluir-2-sim");
  b.disabled = true; b.textContent = "Excluindo…";
  try {
    await rpc("excluir_lote", {
      p_lote: loteParaExcluir.id,
      p_motivo: loteParaExcluir.motivo,
    });
    aviso("Inventário excluído", "ok");
    fechaModais();
    carregarLotes();
  } catch (e) {
    aviso("Não foi possível excluir: " + e.message);
    b.disabled = false; b.textContent = "Sim, excluir para sempre";
  }
}

$("motivo-exclusao").addEventListener("change", (e) => {
  $("excluir-1-sim").disabled = !e.target.value;
});
$("excluir-1-nao").addEventListener("click", fechaModais);
$("excluir-1-sim").addEventListener("click", abrirConfirmacaoFinal);
$("excluir-2-nao").addEventListener("click", fechaModais);
$("excluir-2-sim").addEventListener("click", excluirDeVez);
["modal-excluir-1", "modal-excluir-2"].forEach((m) =>
  $(m).addEventListener("click", (e) => { if (e.target === e.currentTarget) fechaModais(); }));

iniciar();
