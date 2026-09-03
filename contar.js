/* =============================================
   contar.js — a tela do coletor
   =============================================
   Regras que esta tela nunca quebra:
   1. Nunca mostra a quantidade do sistema.
   2. Nunca depende de internet para registrar um bipe.
   3. Nunca pré-preenche a quantidade com o total já
      contado — mostra como AVISO, para não dobrar.
   ============================================= */
const $ = (id) => document.getElementById(id);
if (!exigirLogin()) throw new Error("sem login");

const loteId = sessionStorage.getItem("r400_lote");
let pacote = null;            // { lote, itens[] } — sem qtd_sistema
let porEan = new Map();       // ean -> { item, emb }
let porSeq = new Map();       // seq -> item
let contagens = [];           // tudo o que este aparelho conhece
let selecionado = null;       // { item, emb, ean }
let ultimo = null;
const dispositivo = obterDispositivo();

function obterDispositivo() {
  let d = localStorage.getItem("r400_dispositivo");
  if (!d) { d = "coletor-" + novoId().slice(0, 8); localStorage.setItem("r400_dispositivo", d); }
  return d;
}

/* ---------- som ---------- */
const audio = (() => { try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } })();
function bip(tipo) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.connect(g); g.connect(audio.destination);
  if (tipo === "ok") {
    o.frequency.setValueAtTime(880, audio.currentTime);
    o.frequency.setValueAtTime(1150, audio.currentTime + .07);
  } else {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(220, audio.currentTime);
    o.frequency.setValueAtTime(170, audio.currentTime + .1);
  }
  g.gain.setValueAtTime(.18, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .28);
  o.start(); o.stop(audio.currentTime + .28);
}
document.addEventListener("touchstart", () => { if (audio?.state === "suspended") audio.resume(); }, { once: true });

/* ---------- carga ---------- */
async function carregar() {
  if (!loteId) { location.href = "index.html"; return; }

  pacote = await lerPacote(loteId);              // offline primeiro
  if (pacote) montarIndices();

  try {                                          // depois tenta atualizar
    const novo = await rpc("pacote_lote", { p_lote: loteId });
    if (novo?.lote) {
      pacote = { loteId, ...novo };
      await salvarPacote(pacote);
      montarIndices();
    }
    await puxarDoServidor();
  } catch {
    if (!pacote) {
      $("lote-sub").textContent = "sem conexão e sem cópia local";
      aviso("Abra este inventário uma vez com internet antes de contar.");
      return;
    }
  }

  contagens = await contagensDoLote(loteId);
  $("lote-nome").textContent = pacote.lote.nome;
  if (pacote.lote.status === "fechado") {
    $("aviso-fechado").classList.remove("oculto");
    $("codigo").disabled = true;
  }
  atualizarCabecalho();
  focarCodigo();
}

function montarIndices() {
  porEan = new Map(); porSeq = new Map();
  for (const it of pacote.itens) {
    porSeq.set(String(it.seq), it);
    for (const e of it.eans || []) porEan.set(String(e.ean).trim(), { item: it, emb: Number(e.emb) || 1 });
  }
}

// traz contagens que já estão no servidor (outro aparelho, ou este antes de limpar)
async function puxarDoServidor() {
  const remotas = await api(
    `contagem?select=id,lote_id,seqproduto,ean_lido,quantidade,qtd_embalagem,tipo,dispositivo,criado_em,cancela_id` +
    `&lote_id=eq.${loteId}&limit=20000`);
  const locais = await contagensDoLote(loteId);
  const idsLocais = new Set(locais.map((c) => c.id));
  const novas = remotas.filter((r) => !idsLocais.has(r.id)).map((r) => ({ ...r, enviada: 1 }));
  if (novas.length) await gravarVarias(novas);
}

/* ---------- estado ---------- */
function vivas() {
  const canceladas = new Set(contagens.filter((c) => c.cancela_id).map((c) => c.cancela_id));
  return contagens.filter((c) => !c.cancela_id && !canceladas.has(c.id));
}
function unidadesDo(seq) {
  return vivas().filter((c) => c.seqproduto === seq)
    .reduce((a, c) => a + Number(c.quantidade) * Number(c.qtd_embalagem || 1), 0);
}
function seqsContados() {
  return new Set(vivas().filter((c) => c.seqproduto).map((c) => c.seqproduto));
}
function pendentes() { return contagens.filter((c) => !c.enviada); }

function atualizarCabecalho() {
  const total = pacote.itens.length;
  const feitos = [...seqsContados()].filter((s) => porSeq.has(s)).length;
  $("lote-sub").textContent = `${feitos} de ${total} contados`;
  $("barra").style.width = total ? `${(feitos / total) * 100}%` : "0%";

  const p = pendentes().length;
  const cx = $("aviso-pendente");
  if (p) {
    cx.classList.remove("oculto");
    cx.innerHTML = `<b>${p} contagem${p > 1 ? "s" : ""} ainda não enviada${p > 1 ? "s" : ""}.</b>
      <span>Estão guardadas no aparelho. Quando pegar sinal, toque em <b>Enviar</b> aqui embaixo.</span>`;
  } else cx.classList.add("oculto");

  const marca = $("marca-pendente");
  marca.textContent = p > 99 ? "99+" : p;
  marca.classList.toggle("oculto", p === 0);
}

/* ---------- busca ---------- */
const semAcento = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function procurar(txt) {
  const v = txt.trim();
  if (!v) return [];
  if (porEan.has(v)) { const r = porEan.get(v); return [{ ...r, ean: v }]; }
  if (/^\d+$/.test(v) && porSeq.has(v)) {
    const it = porSeq.get(v);
    const unit = (it.eans || []).find((e) => Number(e.emb) === 1) || (it.eans || [])[0];
    return [{ item: it, emb: unit ? Number(unit.emb) : 1, ean: unit?.ean || null }];
  }
  const palavras = semAcento(v).split(/\s+/).filter(Boolean);
  return pacote.itens
    .filter((it) => { const n = semAcento(it.desc); return palavras.every((p) => n.includes(p)); })
    .slice(0, 40)
    .map((it) => {
      const unit = (it.eans || []).find((e) => Number(e.emb) === 1) || (it.eans || [])[0];
      return { item: it, emb: unit ? Number(unit.emb) : 1, ean: unit?.ean || null };
    });
}

function aoEnter(e) {
  if (e.key !== "Enter") return;
  const v = $("codigo").value.trim();
  if (!v) return;

  const achados = procurar(v);

  if (achados.length === 0) {
    if (/^\d+$/.test(v)) {
      bloquearForaDoLote(v);
    } else {
      $("resultado").innerHTML = `<div class="nota nota--erro">Nenhum produto com esse nome neste inventário.</div>`;
      bip("erro"); focarCodigo();
    }
    return;
  }
  if (achados.length === 1) { selecionar(achados[0]); return; }
  listar(achados);
}

function listar(achados) {
  const div = document.createElement("div");
  div.className = "lista";
  div.style.marginTop = ".6rem";
  achados.forEach((a) => {
    const el = document.createElement("div");
    el.className = "item";
    el.style.cursor = "pointer";
    el.innerHTML = `<span class="item-desc">${a.item.desc}</span>
      <span class="item-info">código ${a.item.seq}${a.emb !== 1 ? ` · embalagem ${a.emb}` : ""}</span>`;
    el.addEventListener("click", () => selecionar(a));
    div.appendChild(el);
  });
  $("resultado").innerHTML = "";
  $("resultado").appendChild(div);
}

function selecionar(a) {
  selecionado = a;
  const ja = unidadesDo(a.item.seq);

  $("resultado").innerHTML = `
    <div class="item" style="background:var(--azul-claro);border-color:var(--azul)">
      <span class="item-desc">${a.item.desc}</span>
      <span class="item-info">código ${a.item.seq}${a.ean ? ` · EAN ${a.ean}` : " · sem código de barras"}</span>
    </div>`;

  const cv = $("conversao");
  if (a.emb !== 1) {
    cv.classList.remove("oculto");
    cv.innerHTML = `<b>Embalagem com ${numeroBR(a.emb)} unidades.</b>
      <span>Digite quantas embalagens você contou. A conversão para unidades acontece na comparação.</span>`;
  } else cv.classList.add("oculto");

  const jc = $("jacontado");
  if (ja > 0) {
    jc.classList.remove("oculto");
    jc.innerHTML = `<b>Este produto já tem ${numeroBR(ja)} UN contadas neste inventário.</b>
      <span>O que você lançar agora vai <b>somar</b> a isso. Se foi engano, use Desfazer.</span>`;
  } else jc.classList.add("oculto");

  $("caixa-qtd").style.display = "flex";
  const q = $("quantidade");
  q.value = $("qtde1").checked ? "1" : "";     // NUNCA o total anterior
  if ($("qtde1").checked) { lancar(); return; }
  q.focus(); q.select();
}

// Produto que não está no inventário é BLOQUEADO.
// Não importa se existe no cadastro: se não veio no relatório
// colado, não entra na contagem. Numa recontagem, isso também
// barra produto que existe no inventário original mas não foi
// marcado para recontar.
function bloquearForaDoLote(lido) {
  selecionado = null;
  $("resultado").innerHTML = `
    <div class="nota nota--erro">
      <b>Este produto não faz parte deste inventário.</b>
      <span>Só é possível contar os produtos do relatório de estoque que abriu
      esta contagem. Confira se você bipou o produto certo.</span>
      <span class="fraco" style="font-family:ui-monospace,monospace;margin-top:.2rem">
        lido: ${lido}</span>
    </div>`;
  bip("erro");
  $("caixa-qtd").style.display = "none";
  $("quantidade").value = "";
  focarCodigo();
}

/* ---------- lançar ---------- */
async function lancar() {
  if (!selecionado) return;
  // cinto e suspensório: o banco também recusa, mas aqui a mensagem é clara
  if (!selecionado.item || !porSeq.has(String(selecionado.item.seq))) {
    aviso("Este produto não faz parte deste inventário");
    bip("erro");
    return;
  }
  const bruto = $("quantidade").value.trim();
  const qtd = bruto === "" ? NaN : Number(bruto);
  if (Number.isNaN(qtd) || Math.abs(qtd) > 999999) { aviso("Quantidade inválida"); bip("erro"); return; }
  if (qtd === 0) { limpar(); return; }

  const reg = {
    id: novoId(),
    lote_id: loteId,
    seqproduto: selecionado.item ? String(selecionado.item.seq) : null,
    ean_lido: selecionado.ean || null,
    quantidade: qtd,                                   // CRU, como digitado
    qtd_embalagem: selecionado.emb || 1,
    tipo: "loja",                                      // seletor Loja/Deposito removido da tela
    dispositivo,
    criado_em: new Date().toISOString(),
    cancela_id: null,
    enviada: 0,
  };

  await gravarContagem(reg);
  contagens.push(reg);
  ultimo = reg;
  bip("ok");

  const desc = selecionado.item ? selecionado.item.desc : `EAN ${selecionado.ean}`;
  const un = qtd * (selecionado.emb || 1);
  const totalAgora = selecionado.item ? unidadesDo(String(selecionado.item.seq)) : un;
  $("caixa-ultimo").classList.remove("oculto");
  $("ultimo").innerHTML = `
    <div class="item-desc">${desc}</div>
    <div class="item-info">lançado ${numeroBR(qtd)}${
      (selecionado.emb || 1) !== 1 ? ` × ${numeroBR(selecionado.emb)} = ${numeroBR(un)} UN` : " UN"}</div>
    <div class="fraco">total deste produto agora: <b>${numeroBR(totalAgora)} UN</b></div>`;

  limpar();
  atualizarCabecalho();
  enviar(true);                                        // tenta em segundo plano
}

function limpar() {
  selecionado = null;
  $("codigo").value = "";
  $("resultado").innerHTML = "";
  $("caixa-qtd").style.display = "none";
  $("quantidade").value = $("qtde1").checked ? "1" : "";
  $("conversao").classList.add("oculto");
  $("jacontado").classList.add("oculto");
  focarCodigo();
}
function focarCodigo() { const c = $("codigo"); if (!c.disabled) { c.focus(); c.select(); } }

/* ---------- desfazer ---------- */
async function desfazer() {
  if (!ultimo) return;
  if (!ultimo.enviada) {
    await apagarContagem(ultimo.id);                   // nunca chegou ao servidor
    contagens = contagens.filter((c) => c.id !== ultimo.id);
  } else {
    const cancel = { ...ultimo, id: novoId(), cancela_id: ultimo.id,
                     criado_em: new Date().toISOString(), enviada: 0 };
    await gravarContagem(cancel);
    contagens.push(cancel);
  }
  ultimo = null;
  $("caixa-ultimo").classList.add("oculto");
  aviso("Contagem desfeita", "ok");
  atualizarCabecalho();
  enviar(true);
  focarCodigo();
}

/* ---------- envio ---------- */
let enviando = false;
async function enviar(silencioso = false) {
  if (enviando) return;
  const fila = pendentes();
  if (!fila.length) { if (!silencioso) aviso("Tudo já enviado", "ok"); return; }
  if (!navigator.onLine) { if (!silencioso) aviso("Sem conexão — as contagens ficam guardadas", "alerta"); return; }

  enviando = true;
  try {
    for (let k = 0; k < fila.length; k += 200) {
      const bloco = fila.slice(k, k + 200).map(({ enviada, ...c }) => c);
      await api("contagem", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(bloco),
      });
      await gravarVarias(fila.slice(k, k + 200).map((c) => ({ ...c, enviada: 1 })));
      fila.slice(k, k + 200).forEach((c) => { c.enviada = 1; });
    }
    if (!silencioso) aviso("Contagens enviadas", "ok");
  } catch (e) {
    if (!silencioso) aviso("Não consegui enviar: " + e.message);
  } finally {
    enviando = false;
    atualizarCabecalho();
  }
}
window.addEventListener("online", () => enviar(true));

/* ---------- faltam contar ---------- */
function abrirFaltam() {
  const feitos = seqsContados();
  const faltam = pacote.itens.filter((it) => !feitos.has(String(it.seq)));
  $("titulo-faltam").textContent = `Faltam contar · ${faltam.length}`;
  const desenhar = (termo) => {
    const t = semAcento(termo || "");
    const l = faltam.filter((it) => !t || semAcento(it.desc).includes(t) || String(it.seq).includes(t));
    $("lista-faltam").innerHTML = l.length
      ? l.map((it) => `<div class="item"><span class="item-desc">${it.desc}</span>
          <span class="item-info">código ${it.seq}</span></div>`).join("")
      : `<p class="fraco">Nada aqui. Tudo contado.</p>`;
  };
  desenhar("");
  $("busca-faltam").value = "";
  $("busca-faltam").oninput = (e) => desenhar(e.target.value);
  $("modal-faltam").classList.add("aberto");
}

/* ---------- já contei ---------- */
// Ordem de contagem = ordem em que foi lançado. O número mostra isso.
function abrirHistorico() {
  const desenhar = (termo) => {
    const t = semAcento(termo || "");
    const canceladas = new Set(contagens.filter((c) => c.cancela_id).map((c) => c.cancela_id));

    const registros = contagens
      .filter((c) => !c.cancela_id)
      .map((c, i) => ({ ...c, ordem: i + 1, morta: canceladas.has(c.id) }))
      .filter((c) => {
        if (!t) return true;
        const nome = porSeq.get(c.seqproduto)?.desc || c.ean_lido || "";
        return semAcento(nome).includes(t) || String(c.ean_lido || "").includes(t);
      })
      .reverse();

    $("titulo-historico").textContent = `Já contei · ${registros.filter((c) => !c.morta).length}`;

    $("lista-historico").innerHTML = registros.length
      ? registros.map((c) => {
          const item = porSeq.get(c.seqproduto);
          const nome = item ? item.desc : `NÃO CADASTRADO · EAN ${c.ean_lido}`;
          const emb = Number(c.qtd_embalagem) || 1;
          const un = Number(c.quantidade) * emb;
          const hora = new Date(c.criado_em).toLocaleTimeString("pt-BR",
            { hour: "2-digit", minute: "2-digit" });
          return `<div class="hist${c.morta ? " hist--morta" : ""}">
            <span class="hist-n">${c.ordem}</span>
            <span class="hist-corpo">
              <span class="item-desc">${nome}</span>
              <span class="item-info">${hora}${emb !== 1
                ? ` · ${numeroBR(c.quantidade)} × ${numeroBR(emb)}` : ""}${
                c.enviada ? "" : " · não enviada"}${c.morta ? " · APAGADA" : ""}</span>
            </span>
            <span class="hist-qtd">${numeroBR(un)} UN</span>
            ${c.morta ? "" : `<button class="hist-apagar" data-apagar="${c.id}" aria-label="Apagar">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>`}
          </div>`;
        }).join("")
      : `<p class="fraco">Nada lançado ainda.</p>`;

    $("lista-historico").querySelectorAll("[data-apagar]").forEach((b) =>
      b.addEventListener("click", () => apagarLancamento(b.dataset.apagar, () => desenhar($("busca-historico").value))));
  };

  desenhar("");
  $("busca-historico").value = "";
  $("busca-historico").oninput = (e) => desenhar(e.target.value);
  $("modal-historico").classList.add("aberto");
}

// Apagar um lançamento qualquer, não só o último.
// Se ainda não subiu, some de vez. Se já subiu, entra um cancelamento
// — a trilha continua inteira para a auditoria.
async function apagarLancamento(id, aoTerminar) {
  const alvo = contagens.find((c) => c.id === id);
  if (!alvo) return;
  if (!alvo.enviada) {
    await apagarContagem(alvo.id);
    contagens = contagens.filter((c) => c.id !== alvo.id);
  } else {
    const cancel = { ...alvo, id: novoId(), cancela_id: alvo.id,
                     criado_em: new Date().toISOString(), enviada: 0 };
    await gravarContagem(cancel);
    contagens.push(cancel);
  }
  if (ultimo?.id === id) { ultimo = null; $("caixa-ultimo").classList.add("oculto"); }
  aviso("Lançamento apagado", "ok");
  atualizarCabecalho();
  enviar(true);
  aoTerminar?.();
}

/* ---------- ligações ---------- */
$("codigo").addEventListener("keydown", aoEnter);
$("quantidade").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lancar(); } });
$("btn-lancar").addEventListener("click", lancar);
$("btn-desfazer").addEventListener("click", desfazer);

$("btn-enviar").addEventListener("click", () => enviar(false));
$("btn-faltam").addEventListener("click", abrirFaltam);
$("btn-historico").addEventListener("click", abrirHistorico);

[["fechar-faltam", "modal-faltam"], ["fechar-historico", "modal-historico"]].forEach(([b, m]) => {
  $(b).addEventListener("click", () => $(m).classList.remove("aberto"));
  $(m).addEventListener("click", (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove("aberto");
  });
});

$("qtde1").addEventListener("change", (e) => {
  $("quantidade").readOnly = e.target.checked;
  $("quantidade").value = e.target.checked ? "1" : "";
});

window.addEventListener("beforeunload", (e) => {
  if (pendentes().length) { e.preventDefault(); e.returnValue = ""; }
});

carregar();
