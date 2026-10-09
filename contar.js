/* =============================================
   contar.js — a tela do coletor
   =============================================
   Regras que esta tela nunca quebra:
   1. Nunca MOSTRA a quantidade do sistema. (Nos inventários novos o
      coletor recebe o estoque só para o aviso de "contou mais do que o
      sistema tem" — o número nunca aparece na tela.)
   2. Nunca depende de internet para registrar um bipe.
   3. Nunca pré-preenche a quantidade com o total já
      contado — mostra como AVISO, para não dobrar.

   Inventário novo (lote.regras >= 2):
   - todo lançamento diz se é da LOJA ou do DEPÓSITO;
   - "Faltam contar" só tira o produto depois dos dois locais;
   - contou acima do estoque do sistema -> aviso que trava até conferir.
   Com lote.confere_validade, depois da quantidade vem a etapa das datas:
   um lançamento com 3 datas vira 3 linhas com o mesmo grupo_id.
   ============================================= */
const $ = (id) => document.getElementById(id);
if (!exigirLogin()) throw new Error("sem login");

const loteId = sessionStorage.getItem("r400_lote");
let pacote = null;            // { lote, itens[] }
let porEan = new Map();       // ean -> { item, emb }
let porSeq = new Map();       // seq -> item
let contagens = [];           // tudo o que este aparelho conhece
let selecionado = null;       // { item, emb, ean }
let ultimo = null;            // linhas do último lançamento (array)
let editando = null;          // estado do editor do "Já contei"
let etapaDatas = null;        // estado da etapa das datas
const dispositivo = obterDispositivo();

const R2  = () => (pacote?.lote?.regras || 1) >= 2;
const VAL = () => !!pacote?.lote?.confere_validade;
const chaveLocal = () => "r400_local_" + loteId;
let local = (() => { try { return localStorage.getItem(chaveLocal()) || "loja"; } catch { return "loja"; } })();

function obterDispositivo() {
  let d = localStorage.getItem("r400_dispositivo");
  if (!d) { d = "coletor-" + novoId().slice(0, 8); localStorage.setItem("r400_dispositivo", d); }
  return d;
}
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

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

/* ---------- rótulos ---------- */
// Como no cadastro do sistema: UN 1, CX 12, PC 10... A sigla vem do cadastro;
// enquanto não vier, mostra UN para unidade e EMB para as outras.
function siglaDe(seq, emb, ean) {
  const it = porSeq.get(String(seq));
  const e = (it?.eans || []).find((x) => ean && String(x.ean) === String(ean))
         || (it?.eans || []).find((x) => Number(x.emb) === Number(emb));
  return e?.sig || null;
}
const rotuloEmb = (emb, grande, sig) => {
  const n = Number(emb) || 1;
  const txt = `${sig || (n === 1 ? "UN" : "EMB")} ${numeroBR(n)}`;
  return `<span class="emb ${n === 1 ? "emb--un" : "emb--pac"}${grande ? " emb--grande" : ""}">${esc(txt)}</span>`;
};
const rotuloLocal = (t) => `<span class="local-chip">${t === "deposito" ? "Depósito" : "Loja"}</span>`;
const nomeLocal = (t) => t === "deposito" ? "depósito" : "loja";

/* ---------- datas ---------- */
const hoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const isoDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const deIso = (s) => { const [a, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); };
const dataBR = (s, curto) => deIso(s).toLocaleDateString("pt-BR",
  { day: "2-digit", month: "2-digit", year: curto ? "2-digit" : "numeric" });
const diasAte = (s) => Math.round((deIso(s) - hoje()) / 86400000);
const faixa = (s) => { const d = diasAte(s);
  return d <= 0 ? "f-venc" : d <= 7 ? "f-urg" : d <= 15 ? "f-at" : d <= 30 ? "f-ac" : "f-norm"; };
const chipData = (iso, q) => `<span class="vchip ${faixa(iso)}">${q != null ? numeroBR(q) + " × " : ""}${dataBR(iso, true)}</span>`;

// Põe as barras enquanto digita: 101026 -> 10/10/26 · 1010 -> 10/10 · 10102026 -> 10/10/2026
function mascaraData(input) {
  // Não depende de inputType (alguns coletores e teclados não mandam):
  // só deixa de formatar quando a última tecla foi de apagar.
  let apagando = false;
  const formatar = () => {
    if (apagando) return;
    const d = input.value.replace(/\D/g, "").slice(0, 8);
    const f = d.length <= 2 ? d : d.length <= 4 ? `${d.slice(0, 2)}/${d.slice(2)}`
      : `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
    if (f !== input.value) {
      input.value = f;
      try { input.setSelectionRange(f.length, f.length); } catch {}
    }
  };
  input.addEventListener("keydown", (ev) => { apagando = ev.key === "Backspace" || ev.key === "Delete"; });
  input.addEventListener("input", (ev) => {
    if (ev.inputType && ev.inputType.startsWith("delete")) return;
    formatar();
  });
  input.addEventListener("keyup", () => { formatar(); apagando = false; });
  input.addEventListener("paste", () => setTimeout(() => { apagando = false; formatar(); }, 0));
}

/* Formatos aceitos:
   DDMMAA (101026) · DDMMAAAA · DDMM (1010: completa o ano) · MMAA (1026: só mês/ano = último dia do mês) */
function lerData(txt) {
  const v = String(txt || "").replace(/\D/g, "");
  if (!v) return null;
  const valida = (a, m, d) => { const x = new Date(a, m - 1, d);
    return x.getFullYear() === a && x.getMonth() === m - 1 && x.getDate() === d ? x : null; };
  if (v.length === 6 || v.length === 8) {
    const d = +v.slice(0, 2), m = +v.slice(2, 4), a = v.length === 6 ? 2000 + +v.slice(4) : +v.slice(4);
    const x = valida(a, m, d);
    return x ? { iso: isoDe(x), como: "" } : { erro: "Data inválida" };
  }
  if (v.length === 4) {
    const p1 = +v.slice(0, 2), p2 = +v.slice(2);
    if (p2 >= 1 && p2 <= 12) {                         // DDMM
      const h = hoje(); let x = valida(h.getFullYear(), p2, p1);
      if (!x) return { erro: "Data inválida" };
      if ((h - x) / 86400000 > 60) x = valida(h.getFullYear() + 1, p2, p1);
      return { iso: isoDe(x), como: "ano completado" };
    }
    if (p1 >= 1 && p1 <= 12) return { iso: isoDe(new Date(2000 + p2, p1, 0)), como: "só mês/ano → último dia" };
    return { erro: "Data inválida" };
  }
  return { erro: "Digite DDMMAA, DDMM ou MMAA" };
}
function textoData(r) {
  if (!r) return { cls: "", txt: "" };
  if (r.erro) return { cls: "ruim", txt: r.erro };
  const d = diasAte(r.iso);
  let txt = `= ${dataBR(r.iso)}${r.como ? " (" + r.como + ")" : ""} · `;
  if (d < 0) return { cls: "ruim", txt: txt + `VENCIDO há ${-d} dia${d === -1 ? "" : "s"}` };
  if (d === 0) return { cls: "ruim", txt: txt + "vence HOJE" };
  return { cls: "ok", txt: txt + `vence em ${d} dia${d === 1 ? "" : "s"}` };
}

/* ---------- carga ---------- */
async function carregar() {
  if (!loteId) { location.href = "index.html"; return; }

  pacote = await lerPacote(loteId);              // offline primeiro
  if (pacote) montarIndices();

  try {                                          // depois tenta atualizar
    const novo = await rpc("pacote_lote", { p_lote: loteId });
    if (novo?.lote) {
      pacote = { loteId, ...novo, extras: pacote?.extras || [] };
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

  contagens = await lerContagens();
  mostrarNomeLote(pacote.lote.nome);
  if (pacote.lote.status === "fechado") {
    $("aviso-fechado").classList.remove("oculto");
    $("codigo").disabled = true;
  }
  if (R2()) {
    $("caixa-local").classList.remove("oculto");
    $("explica-faltam").textContent =
      "Cada produto só sai daqui depois de contado na loja e no depósito. Se ele não existe em um dos locais, marque.";
  }
  desenharLocal();
  atualizarCabecalho();
  focarCodigo();
  enviar(true);            // já tinha internet ao abrir? manda o que ficou pendente de antes
}

// O banco do aparelho devolve em ordem de id; a tela precisa da ordem em que foi contado.
async function lerContagens() {
  const l = await contagensDoLote(loteId);
  return l.sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
}

function loteFechado() { return pacote?.lote?.status === "fechado"; }

// O <span id="lote-sub"> mora DENTRO do <h1 id="lote-nome">: troca só o texto do nome.
function mostrarNomeLote(nome) {
  const h1 = $("lote-nome");
  const t = h1.firstChild;
  if (t && t.nodeType === Node.TEXT_NODE) t.nodeValue = nome;
  else h1.insertBefore(document.createTextNode(nome), h1.firstChild);
}

function montarIndices() {
  porEan = new Map(); porSeq = new Map();
  for (const it of pacote.itens) {
    porSeq.set(String(it.seq), it);
    for (const e of it.eans || []) porEan.set(String(e.ean).trim(), { item: it, emb: Number(e.emb) || 1 });
  }
  // produtos de fora do relatório que já foram contados neste aparelho
  for (const it of pacote.extras || []) {
    porSeq.set(String(it.seq), it);
    for (const e of it.eans || []) porEan.set(String(e.ean).trim(), { item: it, emb: Number(e.emb) || 1 });
  }
}

// traz contagens que já estão no servidor (outro aparelho, ou este antes de limpar)
async function puxarDoServidor() {
  const remotas = await api(
    `contagem?select=id,lote_id,seqproduto,ean_lido,quantidade,qtd_embalagem,tipo,dispositivo,criado_em,cancela_id,validade,grupo_id` +
    `&lote_id=eq.${loteId}&limit=20000`);
  const locais = await contagensDoLote(loteId);
  const idsLocais = new Set(locais.map((c) => c.id));
  const novas = remotas.filter((r) => !idsLocais.has(r.id)).map((r) => ({ ...r, enviada: 1 }));
  if (novas.length) await gravarVarias(novas);
}

/* ---------- local da contagem ---------- */
function desenharLocal() {
  $("local-loja").setAttribute("aria-pressed", local === "loja");
  $("local-deposito").setAttribute("aria-pressed", local === "deposito");
}
function trocarLocal(novo) {
  local = novo;
  try { localStorage.setItem(chaveLocal(), novo); } catch {}
  desenharLocal();
  if (selecionado) selecionar(selecionado, true);   // atualiza o cartão do produto
  focarCodigo();
}

/* ---------- estado ---------- */
function canceladas() { return new Set(contagens.filter((c) => c.cancela_id).map((c) => c.cancela_id)); }
function vivas() {
  const cx = canceladas();
  return contagens.filter((c) => !c.cancela_id && !cx.has(c.id));
}
function unidadesDo(seq) {
  return vivas().filter((c) => c.seqproduto === seq)
    .reduce((a, c) => a + Number(c.quantidade) * Number(c.qtd_embalagem || 1), 0);
}
function seqsContados() {
  return new Set(vivas().filter((c) => c.seqproduto).map((c) => c.seqproduto));
}
// locais onde o produto já foi conferido (contagem com quantidade, ou "não tem aqui" = zero)
function locaisDo(seq) {
  return new Set(vivas().filter((c) => c.seqproduto === seq).map((c) => c.tipo || "loja"));
}
function completo(seq) { const l = locaisDo(seq); return l.has("loja") && l.has("deposito"); }
function pendentes() { return contagens.filter((c) => !c.enviada); }

function atualizarCabecalho() {
  const total = pacote.itens.length;
  const feitos = R2()
    ? pacote.itens.filter((it) => completo(String(it.seq))).length
    : [...seqsContados()].filter((s) => porSeq.has(s)).length;
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
const semAcento = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
  if (etapaDatas) return;
  const v = $("codigo").value.trim();
  if (!v) return;

  const achados = procurar(v);

  if (achados.length === 0) {
    if (/^\d+$/.test(v)) {
      if (pacote.lote.origem_id) bloquearForaDoLote(v);      // recontagem: só os escolhidos
      else buscarForaDoRelatorio(v);
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
    el.innerHTML = `<span class="item-desc">${esc(a.item.desc)}</span>
      <span class="item-info">código ${a.item.seq} ${rotuloEmb(a.emb, false, siglaDe(a.item.seq, a.emb, a.ean))}</span>`;
    el.addEventListener("click", () => selecionar(a));
    div.appendChild(el);
  });
  $("resultado").innerHTML = "";
  $("resultado").appendChild(div);
}

function selecionar(a, soCartao) {
  selecionado = a;
  const ja = unidadesDo(a.item.seq);

  $("resultado").innerHTML = `
    <div class="item" style="background:var(--azul-claro);border-color:var(--azul);gap:.35rem">
      <span class="item-desc">${esc(a.item.desc)}</span>
      <span>${rotuloEmb(a.emb, true, siglaDe(a.item.seq, a.emb, a.ean))} ${R2() ? rotuloLocal(local) : ""}</span>
      ${a.item.fora ? `<span class="nota nota--alerta" style="margin-top:.2rem"><b>Este produto não está no relatório de estoque.</b>
        <span>Pode contar normalmente: ele vai aparecer como sobra na conferência.</span></span>` : ""}
      <span class="item-info">código ${a.item.seq}${a.ean ? ` · EAN ${a.ean}` : " · sem código de barras"}</span>
    </div>`;
  if (soCartao) return;

  const cv = $("conversao");
  if (a.emb !== 1) {
    cv.classList.remove("oculto");
    const sig = siglaDe(a.item.seq, a.emb, a.ean) || "EMB";
    cv.innerHTML = `<b>Embalagem ${esc(sig)} ${numeroBR(a.emb)}: cada uma tem ${numeroBR(a.emb)} unidades.</b>
      <span>Digite quantas embalagens (${esc(sig)}) você contou. A conversão para unidades acontece na comparação.</span>`;
  } else cv.classList.add("oculto");

  const jc = $("jacontado");
  if (ja > 0) {
    jc.classList.remove("oculto");
    jc.innerHTML = `<b>Este produto já tem ${numeroBR(ja)} UN contadas neste inventário.</b>
      <span>O que você lançar agora vai <b>somar</b> a isso. Se foi engano, use Desfazer.</span>`;
  } else jc.classList.add("oculto");

  $("caixa-qtd").style.display = "flex";
  $("btn-lancar").textContent = VAL() ? "Próximo: validade" : "Lançar";
  const q = $("quantidade");
  q.value = $("qtde1").checked ? "1" : "";     // NUNCA o total anterior
  if ($("qtde1").checked) { lancar(); return; }
  q.focus(); q.select();
}

// Produto com cadastro mas fora do relatório: busca no cadastro (precisa de
// internet), avisa e deixa contar. Na conferência ele aparece como sobra.
async function buscarForaDoRelatorio(v) {
  $("resultado").innerHTML = `<p class="fraco">procurando no cadastro…</p>`;
  let linhas = [];
  try {
    const achou = await api(`cadastro?select=seqproduto&or=(ean.eq.${encodeURIComponent(v)},seqproduto.eq.${encodeURIComponent(v)})&limit=1`);
    if (achou.length) linhas = await api(
      `cadastro?select=seqproduto,ean,descricao,qtd_embalagem,embalagem&seqproduto=eq.${encodeURIComponent(achou[0].seqproduto)}`);
  } catch {
    $("resultado").innerHTML = `<div class="nota nota--erro"><b>Este produto não está no relatório e estou sem internet.</b>
      <span>Para contar produto de fora do relatório preciso consultar o cadastro. Tente de novo quando pegar sinal.</span></div>`;
    bip("erro"); focarCodigo(); return;
  }
  if (!linhas.length) { bloquearForaDoLote(v, true); return; }
  const it = {
    seq: String(linhas[0].seqproduto), desc: linhas[0].descricao || "SEM DESCRIÇÃO", qtd: null, fora: true,
    eans: linhas.map((l) => ({ ean: l.ean, emb: Number(l.qtd_embalagem) || 1, sig: l.embalagem || null })),
  };
  pacote.extras = [...(pacote.extras || []).filter((x) => x.seq !== it.seq), it];
  salvarPacote(pacote).catch(() => {});
  montarIndices();
  const r = procurar(v);
  selecionar(r[0] || { item: it, emb: 1, ean: null });
}

// Produto que não está no inventário é BLOQUEADO.
function bloquearForaDoLote(lido, semCadastro) {
  selecionado = null;
  $("resultado").innerHTML = `
    <div class="nota nota--erro">
      <b>${semCadastro ? "Código não encontrado no cadastro." : "Este produto não faz parte desta recontagem."}</b>
      <span>${semCadastro ? "Confira se você bipou o produto certo."
        : "Na recontagem só entram os produtos escolhidos. Confira se você bipou o produto certo."}</span>
      <span class="fraco" style="font-family:ui-monospace,monospace;margin-top:.2rem">
        lido: ${esc(lido)}</span>
    </div>`;
  bip("erro");
  $("caixa-qtd").style.display = "none";
  $("quantidade").value = "";
  focarCodigo();
}

/* ---------- lançar ---------- */
async function lancar() {
  if (!selecionado) return;
  if (!selecionado.item || !porSeq.has(String(selecionado.item.seq))) {
    aviso("Este produto não faz parte deste inventário");
    bip("erro");
    return;
  }
  const bruto = $("quantidade").value.trim();
  const qtd = bruto === "" ? NaN : Number(bruto);
  if (Number.isNaN(qtd) || qtd < 0 || Math.abs(qtd) > 999999) { aviso("Quantidade inválida"); bip("erro"); return; }
  if (qtd === 0) { limpar(); return; }

  if (VAL()) { abrirDatas(qtd); return; }
  await gravarLancamento([{ validade: null, q: qtd }]);
}

// Grava as linhas de um lançamento (uma por data) e faz as conferências.
async function gravarLancamento(lista) {
  const s = selecionado;
  const gid = VAL() ? novoId() : null;
  const agora = new Date().toISOString();
  const linhas = lista.map((x) => ({
    id: novoId(),
    lote_id: loteId,
    seqproduto: String(s.item.seq),
    ean_lido: s.ean || null,
    quantidade: x.q,                                   // CRU, como digitado
    qtd_embalagem: s.emb || 1,
    tipo: R2() ? local : "loja",
    dispositivo,
    criado_em: agora,
    cancela_id: null,
    validade: x.validade || null,
    grupo_id: gid,
    enviada: 0,
  }));

  await gravarVarias(linhas);
  contagens.push(...linhas);
  ultimo = linhas;
  bip("ok");

  const total = lista.reduce((a, x) => a + x.q, 0);
  const emb = s.emb || 1;
  const totalAgora = unidadesDo(String(s.item.seq));
  $("caixa-ultimo").classList.remove("oculto");
  $("ultimo").innerHTML = `
    <div class="item-desc">${esc(s.item.desc)}</div>
    <div>${rotuloEmb(emb, false, siglaDe(s.item.seq, emb, s.ean))} ${R2() ? rotuloLocal(linhas[0].tipo) : ""}</div>
    <div class="item-info">lançado ${numeroBR(total)}${
      emb !== 1 ? ` × ${numeroBR(emb)} = ${numeroBR(total * emb)} UN` : " UN"}</div>
    ${linhas.some((l) => l.validade) ? `<div class="chips">${linhas.map((l) => chipData(l.validade, l.quantidade)).join("")}</div>` : ""}
    <div class="fraco">total deste produto agora: <b>${numeroBR(totalAgora)} UN</b></div>`;

  const seq = String(s.item.seq), chave = gid || linhas[0].id;
  limpar();
  atualizarCabecalho();
  enviar(true);                                        // tenta em segundo plano
  if (R2()) verificarEstoque(seq, chave);
}

function limpar() {
  selecionado = null;
  etapaDatas = null;
  $("caixa-datas").classList.add("oculto");
  $("caixa-datas").innerHTML = "";
  $("codigo").disabled = loteFechado();
  $("codigo").value = "";
  $("resultado").innerHTML = "";
  $("caixa-qtd").style.display = "none";
  $("quantidade").value = $("qtde1").checked ? "1" : "";
  $("conversao").classList.add("oculto");
  $("jacontado").classList.add("oculto");
  focarCodigo();
}
function focarCodigo() { const c = $("codigo"); if (!c.disabled) { c.focus(); c.select(); } }

/* ---------- etapa das datas ----------
   Data + Enter vai para a quantidade; quantidade + Enter registra a data
   (vazia = tudo o que falta). Quando a soma fecha o total, salva sozinho. */
function abrirDatas(total) {
  etapaDatas = { total, lista: [] };
  $("caixa-qtd").style.display = "none";
  $("codigo").disabled = true;
  desenharDatas();
}

const somaLista = (l) => +l.reduce((a, x) => a + x.q, 0).toFixed(3);

function desenharDatas() {
  const e = etapaDatas, box = $("caixa-datas");
  const falta = +(e.total - somaLista(e.lista)).toFixed(3);
  const un = selecionado.emb !== 1 ? " pct" : " un";
  box.classList.remove("oculto");
  box.innerHTML = `<div class="datas">
    <div class="datas-cab"><b>Validade · ${numeroBR(e.total)}${un}</b>
      <span class="faltam-q">faltam ${numeroBR(falta)}</span></div>
    ${e.lista.map((x, i) => `<div class="data-linha">${chipData(x.validade)}
      <span class="q">${numeroBR(x.q)}${un}</span>
      <button type="button" class="data-x" data-rm="${i}" aria-label="Tirar esta data">×</button></div>`).join("")}
    <div class="data-nova">
      <div class="campo"><label for="d-data">Data</label>
        <input type="text" id="d-data" class="grande" inputmode="numeric" placeholder="DD/MM/AA" autocomplete="off"/></div>
      <div class="campo"><label for="d-qtd">Qtd</label>
        <input type="number" id="d-qtd" class="grande" step="any" inputmode="decimal" placeholder="${numeroBR(falta)}"/></div>
    </div>
    <div class="data-interp" id="d-interp">Data + Enter, depois Qtd + Enter (vazia = os ${numeroBR(falta)} que faltam)</div>
    <button type="button" class="btn btn--2 btn--bloco" id="d-voltar">Voltar e corrigir a quantidade</button>
  </div>`;

  box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
    e.lista.splice(+b.dataset.rm, 1); desenharDatas();
  }));
  $("d-voltar").addEventListener("click", () => {
    etapaDatas = null;
    box.classList.add("oculto"); box.innerHTML = "";
    $("codigo").disabled = false;
    $("caixa-qtd").style.display = "flex";
    $("quantidade").focus(); $("quantidade").select();
  });

  const dIn = $("d-data"), qIn = $("d-qtd"), info = $("d-interp");
  mascaraData(dIn);
  const mostrar = () => {
    const r = lerData(dIn.value);
    if (!r) { info.className = "data-interp";
      info.textContent = `Data + Enter, depois Qtd + Enter (vazia = os ${numeroBR(falta)} que faltam)`; return null; }
    const t = textoData(r); info.className = "data-interp " + t.cls; info.textContent = t.txt;
    return r.erro ? null : r.iso;
  };
  dIn.addEventListener("input", mostrar);
  dIn.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    if (mostrar()) { qIn.focus(); qIn.select(); } else bip("erro");
  });
  qIn.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const iso = mostrar(); if (!iso) { dIn.focus(); bip("erro"); return; }
    const q = qIn.value === "" ? falta : Number(qIn.value);
    if (!(q > 0)) { aviso("Quantidade inválida"); bip("erro"); return; }
    if (q > falta) { aviso(`Passa do total: faltam só ${numeroBR(falta)}`); bip("erro"); qIn.select(); return; }
    const ja = e.lista.find((x) => x.validade === iso);
    if (ja) ja.q = +(ja.q + q).toFixed(3); else e.lista.push({ validade: iso, q });
    e.lista.sort((a, b) => a.validade.localeCompare(b.validade));
    if (somaLista(e.lista) === +e.total.toFixed(3)) {     // fechou o total: salva sozinho
      const lista = e.lista;
      etapaDatas = null;
      gravarLancamento(lista);
    } else desenharDatas();
  });
  dIn.focus();
}

/* ---------- aviso: contou acima do estoque ----------
   Soma tudo o que já foi contado do produto (loja + depósito, pacotes em
   unidades) e compara com o estoque do sistema. Não mostra número nenhum. */
let estoquePendente = null;
function verificarEstoque(seq, chave) {
  const it = porSeq.get(seq);
  if (!it || it.qtd == null || it.fora) return;
  if (unidadesDo(seq) <= Number(it.qtd)) return;
  estoquePendente = chave;
  $("estoque-produto").innerHTML = `<div class="item"><span class="item-desc">${esc(it.desc)}</span>
    <span class="item-info">código ${it.seq}</span></div>`;
  $("codigo").disabled = true;
  $("modal-estoque").classList.add("aberto");
  bip("erro");
  $("estoque-manter").focus();
}
function fecharEstoque() {
  $("modal-estoque").classList.remove("aberto");
  $("codigo").disabled = loteFechado();
}
$("estoque-manter").addEventListener("click", () => { fecharEstoque(); estoquePendente = null; focarCodigo(); });
$("estoque-corrigir").addEventListener("click", () => {
  const chave = estoquePendente; fecharEstoque(); estoquePendente = null;
  abrirHistorico(chave);
});

/* ---------- desfazer ---------- */
async function apagarLinha(alvo) {
  if (!alvo.enviada) {
    await apagarContagem(alvo.id);                   // nunca chegou ao servidor
    contagens = contagens.filter((c) => c.id !== alvo.id);
  } else {                                           // já subiu: entra um cancelamento
    const cancel = { ...alvo, id: novoId(), cancela_id: alvo.id,
                     criado_em: new Date().toISOString(), enviada: 0 };
    await gravarContagem(cancel);
    contagens.push(cancel);
  }
}
async function desfazer() {
  if (!ultimo) return;
  try { for (const l of ultimo) await apagarLinha(l); aviso("Contagem desfeita", "ok"); }
  catch (e) { aviso("Não consegui desfazer: " + e.message); }
  ultimo = null;
  $("caixa-ultimo").classList.add("oculto");
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
      const bloco = fila.slice(k, k + 200).map(({ enviada, ...c }) =>
        ({ validade: null, grupo_id: null, ...c }));   // todas as linhas com as mesmas colunas
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
setInterval(() => enviar(true), 30000);   // rede instável: reforça o envio de tempos em tempos

/* ---------- faltam contar ---------- */
function abrirFaltam() {
  const desenhar = (termo) => {
    const t = semAcento(termo || "");
    let faltam;
    if (R2()) {
      faltam = pacote.itens.map((it) => ({ it, l: locaisDo(String(it.seq)) }))
        .filter((x) => !(x.l.has("loja") && x.l.has("deposito")));
    } else {
      const feitos = seqsContados();
      faltam = pacote.itens.filter((it) => !feitos.has(String(it.seq))).map((it) => ({ it, l: new Set() }));
    }
    $("titulo-faltam").textContent = `Faltam contar · ${faltam.length}`;
    const l = faltam.filter(({ it }) => !t || semAcento(it.desc).includes(t) || String(it.seq).includes(t));
    $("lista-faltam").innerHTML = l.length
      ? l.map(({ it, l: loc }) => {
          const falta = ["loja", "deposito"].filter((x) => !loc.has(x));
          return `<div class="item"><span class="item-desc">${esc(it.desc)}</span>
            <span class="item-info">código ${it.seq}</span>
            ${R2() ? `<span class="falta-local">falta: ${falta.length === 2 ? "loja e depósito" : nomeLocal(falta[0])}</span>
              ${!loteFechado() ? `<span class="linha-botoes" style="margin-top:.3rem">${falta.map((x) =>
                `<button type="button" class="btn-pequeno" data-zero="${it.seq}" data-local="${x}">Não tem ${x === "loja" ? "na loja" : "no depósito"}</button>`).join("")}</span>` : ""}` : ""}
          </div>`;
        }).join("")
      : `<p class="fraco">Nada aqui. Tudo contado.</p>`;
    $("lista-faltam").querySelectorAll("[data-zero]").forEach((b) => b.addEventListener("click", async () => {
      await marcarSemProduto(b.dataset.zero, b.dataset.local);
      desenhar($("busca-faltam").value);
    }));
  };
  desenhar("");
  $("busca-faltam").value = "";
  $("busca-faltam").oninput = (e) => desenhar(e.target.value);
  $("modal-faltam").classList.add("aberto");
}

// "Não tem no depósito": vira uma contagem ZERO naquele local. Conta como
// conferido, não muda a soma e fica no "Já contei" (dá para apagar).
async function marcarSemProduto(seq, onde) {
  const reg = {
    id: novoId(), lote_id: loteId, seqproduto: String(seq), ean_lido: null,
    quantidade: 0, qtd_embalagem: 1, tipo: onde, dispositivo,
    criado_em: new Date().toISOString(), cancela_id: null, validade: null, grupo_id: null, enviada: 0,
  };
  await gravarContagem(reg);
  contagens.push(reg);
  aviso(`Marcado: não tem ${onde === "loja" ? "na loja" : "no depósito"}`, "ok");
  atualizarCabecalho();
  enviar(true);
}

/* ---------- já contei ----------
   Cada lançamento é um GRUPO: as linhas com o mesmo grupo_id (uma por
   data de validade). Lançamento antigo, sem grupo, é a própria linha. */
function grupos() {
  const cx = canceladas();
  const mapa = new Map();
  for (const c of contagens) {
    if (c.cancela_id) continue;
    const k = c.grupo_id || c.id;
    if (!mapa.has(k)) mapa.set(k, { chave: k, linhas: [], vivas: [] });
    const g = mapa.get(k);
    g.linhas.push(c);
    if (!cx.has(c.id)) g.vivas.push(c);
  }
  return [...mapa.values()].map((g, i) => {
    const base = g.vivas[0] || g.linhas[0];
    const total = g.vivas.reduce((a, c) => a + Number(c.quantidade), 0);
    return {
      ...g, ordem: i + 1, morta: g.vivas.length === 0,
      seq: base.seqproduto, emb: Number(base.qtd_embalagem) || 1, tipo: base.tipo || "loja",
      ean: base.ean_lido, criado_em: base.criado_em, total,
      zero: g.vivas.length > 0 && total === 0,
      datas: g.vivas.filter((c) => c.validade).map((c) => ({ validade: String(c.validade).slice(0, 10), q: Number(c.quantidade) }))
        .sort((a, b) => a.validade.localeCompare(b.validade)),
      enviada: g.linhas.every((c) => c.enviada),
    };
  });
}

let desenharHistorico = null;
function abrirHistorico(editarChave) {
  editando = null;
  const desenhar = (termo) => {
    const t = semAcento(termo || "");
    const travado = loteFechado();
    const lista = grupos()
      .filter((g) => {
        if (!t) return true;
        const nome = porSeq.get(g.seq)?.desc || g.ean || "";
        return semAcento(nome).includes(t) || String(g.ean || "").includes(t);
      })
      .reverse();

    $("titulo-historico").textContent = `Já contei · ${lista.filter((g) => !g.morta).length}`;

    $("lista-historico").innerHTML = lista.length
      ? lista.map((g) => (!g.morta && !travado && editando?.chave === g.chave) ? htmlEditor(g) : htmlGrupo(g, travado)).join("")
      : `<p class="fraco">Nada lançado ainda.</p>`;

    $("lista-historico").querySelectorAll("[data-apagar]").forEach((b) =>
      b.addEventListener("click", () => apagarGrupo(b.dataset.apagar, () => desenhar($("busca-historico").value))));
    $("lista-historico").querySelectorAll("[data-editar]").forEach((b) =>
      b.addEventListener("click", () => { abrirEditor(b.dataset.editar); desenhar($("busca-historico").value); focarEditor(); }));
    if (editando) ligarEditor(() => desenhar($("busca-historico").value));
  };
  desenharHistorico = desenhar;

  if (editarChave) abrirEditor(editarChave);
  desenhar("");
  $("busca-historico").value = "";
  $("busca-historico").oninput = (e) => desenhar(e.target.value);
  $("modal-historico").classList.add("aberto");
  if (editando) focarEditor();
}

function htmlGrupo(g, travado) {
  const item = porSeq.get(g.seq);
  const nome = item ? item.desc : `NÃO CADASTRADO · EAN ${g.ean}`;
  const un = g.total * g.emb;
  const hora = new Date(g.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `<div class="hist${g.morta ? " hist--morta" : ""}">
    <span class="hist-n">${g.ordem}</span>
    <span class="hist-corpo">
      <span class="item-desc">${esc(nome)}</span>
      <span>${g.zero ? "" : rotuloEmb(g.emb, false, siglaDe(g.seq, g.emb, g.ean))} ${R2() || g.tipo === "deposito" ? rotuloLocal(g.tipo) : ""}</span>
      <span class="item-info">${hora}${g.zero ? ` · não tem ${g.tipo === "deposito" ? "no depósito" : "na loja"}` : ""}${
        !g.zero && g.emb !== 1 ? ` · ${numeroBR(g.total)} × ${numeroBR(g.emb)}` : ""}${
        g.enviada ? "" : " · não enviada"}${g.morta ? " · APAGADA" : ""}</span>
      ${g.datas.length ? `<span class="chips">${g.datas.map((d) => chipData(d.validade, d.q)).join("")}</span>` : ""}
    </span>
    <span class="hist-qtd">${g.zero ? "—" : numeroBR(un) + " UN"}</span>
    ${g.morta || travado ? "" : `${g.zero ? "" : `<button class="hist-editar" data-editar="${g.chave}" aria-label="Editar">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button>`}
    <button class="hist-apagar" data-apagar="${g.chave}" aria-label="Apagar">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
    </button>`}
  </div>`;
}

/* ---------- editor do "Já contei": quantidade, datas e local ---------- */
function abrirEditor(chave) {
  const g = grupos().find((x) => x.chave === chave);
  if (!g || g.morta || g.zero) { editando = null; return; }
  editando = {
    chave, total: g.total, tipo: g.tipo,
    comDatas: VAL() || g.datas.length > 0,
    lista: g.datas.map((d) => ({ ...d })),
  };
}
function focarEditor() {
  setTimeout(() => { const i = $(editando?.comDatas && somaLista(editando.lista) < editando.total ? "ed-data" : "ed-total");
    if (i) { i.focus(); i.select?.(); } }, 0);
}
const podeSalvarEditor = () => editando.total > 0 &&
  (!editando.comDatas || somaLista(editando.lista) === +Number(editando.total).toFixed(3));

function htmlEditor(g) {
  const e = editando;
  const item = porSeq.get(g.seq);
  const un = g.emb !== 1 ? " pct" : " un";
  const falta = +(e.total - somaLista(e.lista)).toFixed(3);
  return `<div class="editor">
    <div class="item-desc">${esc(item ? item.desc : "EAN " + g.ean)} ${rotuloEmb(g.emb, false, siglaDe(g.seq, g.emb, g.ean))}</div>
    <div class="campo"><label for="ed-total">Quantidade${g.emb !== 1 ? " (pacotes)" : ""}</label>
      <input type="number" id="ed-total" class="grande" step="any" inputmode="decimal" value="${e.total}"/></div>
    ${R2() ? `<div class="local" role="group" aria-label="Local">
      <button type="button" id="ed-loja" aria-pressed="${e.tipo === "loja"}">LOJA</button>
      <button type="button" id="ed-deposito" aria-pressed="${e.tipo === "deposito"}">DEPÓSITO</button></div>` : ""}
    ${e.comDatas ? `<div class="datas-cab"><b>Validade</b>
        <span class="faltam-q${falta === 0 ? " ok" : ""}" id="ed-falta">${falta === 0 ? "tudo com data" : (falta > 0 ? "faltam " : "passou ") + numeroBR(Math.abs(falta))}</span></div>
      ${e.lista.map((x, i) => `<div class="data-linha">${chipData(x.validade)}
        <span class="q">${numeroBR(x.q)}${un}</span>
        <button type="button" class="data-x" data-edrm="${i}" aria-label="Tirar esta data">×</button></div>`).join("")}
      <div class="data-nova">
        <div class="campo"><label for="ed-data">Data</label>
          <input type="text" id="ed-data" inputmode="numeric" placeholder="DD/MM/AA" autocomplete="off"/></div>
        <div class="campo"><label for="ed-qtd">Qtd</label>
          <input type="number" id="ed-qtd" step="any" inputmode="decimal" placeholder="${falta > 0 ? numeroBR(falta) : ""}"/></div>
      </div>
      <div class="data-interp" id="ed-interp">Tire a data errada no × e digite a certa</div>` : ""}
    <div class="linha-botoes">
      <button type="button" class="btn btn--2" id="ed-cancelar">Cancelar</button>
      <button type="button" class="btn" id="ed-salvar" ${podeSalvarEditor() ? "" : "disabled"}>Salvar</button>
    </div>
  </div>`;
}

function ligarEditor(redesenhar) {
  const e = editando;
  const atualizarBotao = () => {
    $("ed-salvar").disabled = !podeSalvarEditor();
    const f = $("ed-falta");
    if (f) { const falta = +(e.total - somaLista(e.lista)).toFixed(3);
      f.className = "faltam-q" + (falta === 0 ? " ok" : "");
      f.textContent = falta === 0 ? "tudo com data" : (falta > 0 ? "faltam " : "passou ") + numeroBR(Math.abs(falta)); }
  };
  $("ed-total").addEventListener("input", (ev) => { e.total = Number(ev.target.value) || 0; atualizarBotao(); });
  $("ed-total").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return; ev.preventDefault();
    if (podeSalvarEditor()) salvarEditor(redesenhar);
    else if (e.comDatas) $("ed-data")?.focus();
  });
  ["loja", "deposito"].forEach((x) => $("ed-" + x)?.addEventListener("click", () => {
    e.tipo = x; $("ed-loja").setAttribute("aria-pressed", x === "loja");
    $("ed-deposito").setAttribute("aria-pressed", x === "deposito");
  }));
  $("ed-cancelar").addEventListener("click", () => { editando = null; redesenhar(); });
  $("ed-salvar").addEventListener("click", () => salvarEditor(redesenhar));

  if (!e.comDatas) return;
  document.querySelectorAll("[data-edrm]").forEach((b) => b.addEventListener("click", () => {
    e.lista.splice(+b.dataset.edrm, 1); redesenhar(); focarEditor();
  }));
  const dIn = $("ed-data"), qIn = $("ed-qtd"), info = $("ed-interp");
  mascaraData(dIn);
  const mostrar = () => {
    const r = lerData(dIn.value);
    if (!r) { info.className = "data-interp"; info.textContent = "Tire a data errada no × e digite a certa"; return null; }
    const t = textoData(r); info.className = "data-interp " + t.cls; info.textContent = t.txt;
    return r.erro ? null : r.iso;
  };
  dIn.addEventListener("input", mostrar);
  dIn.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return; ev.preventDefault();
    if (mostrar()) { qIn.focus(); qIn.select(); } else bip("erro");
  });
  qIn.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return; ev.preventDefault();
    const iso = mostrar(); if (!iso) { dIn.focus(); bip("erro"); return; }
    const falta = +(e.total - somaLista(e.lista)).toFixed(3);
    const q = qIn.value === "" ? falta : Number(qIn.value);
    if (!(q > 0)) { aviso("Quantidade inválida"); bip("erro"); return; }
    if (q > falta) { aviso(`Passa do total: faltam só ${numeroBR(falta)}`); bip("erro"); qIn.select(); return; }
    const ja = e.lista.find((x) => x.validade === iso);
    if (ja) ja.q = +(ja.q + q).toFixed(3); else e.lista.push({ validade: iso, q });
    e.lista.sort((a, b) => a.validade.localeCompare(b.validade));
    if (podeSalvarEditor()) salvarEditor(redesenhar);    // fechou o total: salva sozinho
    else { redesenhar(); focarEditor(); }
  });
}

// Reaproveita as linhas do grupo (mesmo id = upsert no servidor), cria as
// que faltam e apaga/cancela as que sobraram.
async function salvarEditor(redesenhar) {
  const e = editando;
  if (!e || !podeSalvarEditor()) return;
  const g = grupos().find((x) => x.chave === e.chave);
  if (!g) { editando = null; redesenhar(); return; }
  const vivasG = [...g.vivas].sort((a, b) => String(a.validade || "").localeCompare(String(b.validade || "")));
  const desejado = e.comDatas ? e.lista.map((x) => ({ validade: x.validade, q: x.q }))
                              : [{ validade: vivasG[0]?.validade || null, q: Number(e.total) }];
  const gid = e.comDatas ? (vivasG[0]?.grupo_id || novoId()) : (vivasG[0]?.grupo_id || null);
  try {
    for (let i = 0; i < desejado.length; i++) {
      const d = desejado[i];
      const base = vivasG[i];
      const linha = base
        ? { ...base, quantidade: d.q, validade: d.validade, tipo: e.tipo, grupo_id: gid, enviada: 0 }
        : { ...vivasG[0], id: novoId(), quantidade: d.q, validade: d.validade, tipo: e.tipo, grupo_id: gid,
            criado_em: new Date().toISOString(), cancela_id: null, enviada: 0 };
      await gravarContagem(linha);
      const k = contagens.findIndex((c) => c.id === linha.id);
      if (k >= 0) contagens[k] = linha; else contagens.push(linha);
    }
    for (const sobra of vivasG.slice(desejado.length)) await apagarLinha(sobra);
    if (ultimo?.some((l) => (l.grupo_id || l.id) === e.chave)) { ultimo = null; $("caixa-ultimo").classList.add("oculto"); }
    aviso("Lançamento corrigido", "ok");
    bip("ok");
  } catch (err) {
    aviso("Não consegui salvar a correção: " + err.message);
    bip("erro");
  } finally {
    editando = null;
    atualizarCabecalho();
    enviar(true);
    redesenhar();
  }
}

// Apagar um lançamento inteiro (todas as datas dele).
async function apagarGrupo(chave, aoTerminar) {
  const g = grupos().find((x) => x.chave === chave);
  if (!g) return;
  try {
    for (const l of g.vivas) await apagarLinha(l);
    if (ultimo?.some((l) => (l.grupo_id || l.id) === chave)) { ultimo = null; $("caixa-ultimo").classList.add("oculto"); }
    if (editando?.chave === chave) editando = null;
    aviso("Lançamento apagado", "ok");
  } catch (e) {
    aviso("Não consegui apagar: " + e.message);
  } finally {
    atualizarCabecalho();
    enviar(true);
    aoTerminar?.();
  }
}

/* ---------- ligações ---------- */
$("codigo").addEventListener("keydown", aoEnter);
$("quantidade").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lancar(); } });
$("btn-lancar").addEventListener("click", lancar);
$("btn-desfazer").addEventListener("click", desfazer);
$("local-loja").addEventListener("click", () => trocarLocal("loja"));
$("local-deposito").addEventListener("click", () => trocarLocal("deposito"));

$("btn-enviar").addEventListener("click", () => enviar(false));
$("btn-faltam").addEventListener("click", abrirFaltam);
$("btn-historico").addEventListener("click", () => abrirHistorico());

[["fechar-faltam", "modal-faltam"], ["fechar-historico", "modal-historico"]].forEach(([b, m]) => {
  const fechar = () => { $(m).classList.remove("aberto"); if (m === "modal-historico") editando = null; focarCodigo(); };
  $(b).addEventListener("click", fechar);
  $(m).addEventListener("click", (e) => { if (e.target === e.currentTarget) fechar(); });
});

$("qtde1").addEventListener("change", (e) => {
  $("quantidade").readOnly = e.target.checked;
  $("quantidade").value = e.target.checked ? "1" : "";
});

window.addEventListener("beforeunload", (e) => {
  if (pendentes().length) { e.preventDefault(); e.returnValue = ""; }
});

carregar();
