/* =============================================
   divergencias.js — fecha o lote e monta o relatório
   =============================================
   A conversão pela embalagem acontece no banco,
   dentro de divergencia_lote(). Aqui só apresenta.

   Numa RECONTAGEM a tela também compara com o
   inventário de origem. O que interessa não é o
   número contado (entre as duas contagens houve
   venda), e sim a DIFERENÇA: se ela se manteve, a
   divergência é real.
   ============================================= */
const $ = (id) => document.getElementById(id);
if (!exigirLogin()) throw new Error("sem login");

const loteId = sessionStorage.getItem("r400_lote");
let lote = null, linhas = [], mostrarTudo = false;
let origem = null, linhasOrigem = new Map(), mostrarComp = true;

const ROTULOS = {
  falta:          { txt: "Falta",          cls: "selo--falta", cor: "FFF4D3D0" },
  sobra:          { txt: "Sobra",          cls: "selo--sobra", cor: "FFD4EDDB" },
  nao_conferido:  { txt: "Não Conferido",  cls: "selo--nconf", cor: "FFFAF0CC" },
  nao_cadastrado: { txt: "Não Cadastrado", cls: "selo--ncad",  cor: "FFD6E6F8" },
  ok:             { txt: "Confere",        cls: "selo--ok",    cor: "FFFFFFFF" },
};

/* Veredito da recontagem: o que a segunda contagem provou. */
const VEREDITOS = {
  confirmou:     { txt: "Confirmou",            cls: "selo--falta", cor: "FFF4D3D0" },
  sistema:       { txt: "Sistema se acertou",   cls: "selo--ncad",  cor: "FFD6E6F8" },
  contagem:      { txt: "Contagem se acertou",  cls: "selo--sobra", cor: "FFD4EDDB" },
  mudou:         { txt: "Mudou",                cls: "selo--nconf", cor: "FFFAF0CC" },
  apareceu:      { txt: "Apareceu agora",       cls: "selo--nconf", cor: "FFFAF0CC" },
  nao_recontado: { txt: "Não recontado",        cls: "selo--ok",    cor: "FFFFFFFF" },
  bateu:         { txt: "Bateu nas duas",       cls: "selo--ok",    cor: "FFFFFFFF" },
  sem_origem:    { txt: "—",                    cls: "selo--ok",    cor: "FFFFFFFF" },
};

const ORDEM_VEREDITO = ["confirmou", "mudou", "apareceu", "contagem", "sistema", "nao_recontado", "bateu"];

/* Compara uma linha da recontagem com a mesma linha do inventário de origem.
   "Sistema se acertou": o contado foi o MESMO nas duas e mesmo assim a
   diferença zerou — quem andou foi o estoque do sistema, ou seja, o
   relatório da primeira vez estava atrasado.
   "Contagem se acertou": o contado mudou na segunda — a primeira errou. */
function comparar(l) {
  const o = l.seqproduto == null ? null : linhasOrigem.get(String(l.seqproduto));
  if (!o) return { o: null, chave: "sem_origem", saiu: null };

  const d1 = Number(o.diferenca || 0);
  const d2 = Number(l.diferenca || 0);
  const saiu = (o.qtd_sistema == null || l.qtd_sistema == null)
    ? null : Number(o.qtd_sistema) - Number(l.qtd_sistema);

  let chave;
  if (l.situacao === "nao_conferido")  chave = "nao_recontado";
  else if (d1 === 0 && d2 === 0)       chave = "bateu";
  else if (d1 === 0)                   chave = "apareceu";
  else if (d2 === 0)                   chave = Number(l.qtd_contada) === Number(o.qtd_contada)
                                                ? "sistema" : "contagem";
  else if (d2 === d1)                  chave = "confirmou";
  else                                 chave = "mudou";

  return { o, chave, saiu };
}

const temComparativo = () => !!origem && linhasOrigem.size > 0;
const comparativoLigado = () => temComparativo() && mostrarComp;

/* O <span id="lote-sub"> mora DENTRO do <h1 id="lote-nome">. Usar
   textContent no h1 apagava o span, e a linha seguinte estourava em
   null.textContent — derrubando o resto do carregar(), inclusive a
   busca do inventário de origem. Aqui troca só o texto e deixa o span vivo. */
function mostrarNomeLote(nome) {
  const h1 = $("lote-nome");
  const t = h1.firstChild;
  if (t && t.nodeType === Node.TEXT_NODE) t.nodeValue = nome;
  else h1.insertBefore(document.createTextNode(nome), h1.firstChild);
}

async function carregar() {
  if (!loteId) { location.href = "index.html"; return; }
  const [l] = await api(`lote?select=*,loja(nome)&id=eq.${loteId}`);
  if (!l) { aviso("Inventário não encontrado"); return; }
  lote = l;
  mostrarNomeLote(l.nome);
  $("lote-sub").textContent = l.loja?.nome || "";

  // Recontagem: busca o inventário de origem para o comparativo.
  // Se ele tiver sido excluído, origem_id já veio nulo e a tela segue sem comparativo.
  if (l.origem_id) {
    try {
      const [o] = await api(`lote?select=id,nome,retrato_em,fechado_em&id=eq.${l.origem_id}`);
      origem = o || null;
    } catch { origem = null; }
  }

  const itens = await api(`lote_item?select=seqproduto&lote_id=eq.${loteId}`);
  const cont  = await api(`contagem?select=seqproduto,cancela_id&lote_id=eq.${loteId}&limit=20000`);
  const canceladas = new Set(cont.filter((c) => c.cancela_id).map((c) => c.cancela_id));
  const contados = new Set(cont.filter((c) => !c.cancela_id && c.seqproduto).map((c) => c.seqproduto));
  const feitos = [...contados].filter((s) => itens.some((i) => i.seqproduto === s)).length;

  $("situacao").innerHTML = `
    ${feitos} de ${itens.length} produtos contados ·
    retrato do sistema em <b>${dataHoraBR(l.retrato_em)}</b>
    ${l.status === "fechado" ? `<br>Fechado em <b>${dataHoraBR(l.fechado_em)}</b>` : ""}
    ${origem ? `<br>Recontagem de <b>${origem.nome}</b>` : ""}`;

  // regra de ouro virando trava
  const horas = (Date.now() - new Date(l.retrato_em)) / 36e5;
  if (horas > 12 && l.status !== "fechado") {
    $("aviso-retrato").classList.remove("oculto");
    $("aviso-retrato").innerHTML = `<b>Este relatório foi tirado há ${Math.round(horas)} horas.</b>
      <span>Tudo o que foi vendido depois disso e não foi contado vai aparecer como falta.
      Se a contagem não terminou no mesmo dia, o certo é tirar o relatório de novo
      e começar um inventário novo.</span>`;
  }

  if (l.status === "fechado") {
    $("btn-gerar").textContent = "Ver divergências";
    gerar();
  }
}

async function gerar() {
  const b = $("btn-gerar");
  b.disabled = true; b.textContent = "Calculando…";
  try {
    if (lote.status !== "fechado") {
      await rpc("fechar_lote", { p_lote: loteId });
      lote.status = "fechado";
    }
    linhas = await rpc("divergencia_lote", { p_lote: loteId });

    if (origem) {
      try {
        const ant = await rpc("divergencia_lote", { p_lote: origem.id });
        linhasOrigem = new Map(
          ant.filter((x) => x.seqproduto != null).map((x) => [String(x.seqproduto), x]));
      } catch { linhasOrigem = new Map(); }
    }

    desenhar();
    $("caixa-res").style.display = "flex";
    $("caixa-fechar").classList.add("oculto");
  } catch (e) {
    aviso(e.message);
    b.disabled = false; b.textContent = "Fechar e gerar divergências";
  }
}

function desenhar() {
  const comp = comparativoLigado();

  const cont = { falta: 0, sobra: 0, nao_conferido: 0, nao_cadastrado: 0, ok: 0 };
  linhas.forEach((l) => { cont[l.situacao] = (cont[l.situacao] || 0) + 1; });

  $("placar").innerHTML = ["falta", "sobra", "nao_conferido", "nao_cadastrado", "ok"]
    .map((k) => `<div class="p"><span class="v" style="color:var(${
      k === "falta" ? "--falta" : k === "sobra" ? "--sobra" :
      k === "nao_conferido" ? "--atencao" : k === "nao_cadastrado" ? "--info" : "--fraco"
    })">${cont[k] || 0}</span><span class="k">${ROTULOS[k].txt}</span></div>`).join("");

  /* ---- comparativo com a contagem anterior ---- */
  $("btn-comparativo").classList.toggle("oculto", !temComparativo());
  $("btn-comparativo").textContent = mostrarComp
    ? "Esconder comparativo" : "Mostrar comparativo com a 1ª contagem";
  $("placar-comp").classList.toggle("oculto", !comp);
  $("nota-comparativo").classList.toggle("oculto", !comp);

  if (comp) {
    const vc = {};
    linhas.forEach((l) => { const k = comparar(l).chave; vc[k] = (vc[k] || 0) + 1; });
    $("placar-comp").innerHTML = ORDEM_VEREDITO
      .filter((k) => vc[k])
      .map((k) => `<div class="p"><span class="v" style="color:var(${
        k === "confirmou" ? "--falta" : k === "contagem" ? "--sobra" :
        k === "sistema" ? "--info" :
        (k === "mudou" || k === "apareceu") ? "--atencao" : "--fraco"
      })">${vc[k]}</span><span class="k">${VEREDITOS[k].txt}</span></div>`).join("");

    $("nota-comparativo").innerHTML =
      `<b>Comparando com ${origem.nome}.</b>
       <span>Entre as duas contagens houve venda, então o que vale comparar é a
       <b>diferença</b>, não a quantidade contada.<br>
       <b>Confirmou</b> — a mesma diferença nas duas vezes. É divergência real.<br>
       <b>Sistema se acertou</b> — você contou o mesmo número nas duas e a diferença sumiu:
       quem andou foi o estoque do sistema, o relatório da primeira vez estava atrasado.<br>
       <b>Contagem se acertou</b> — o número contado mudou na segunda: a primeira contagem errou.<br>
       <b>Saiu</b> é quanto o sistema baixou entre as duas (negativo = entrou mercadoria).</span>`;
  }

  /* ---- cabeçalho ----
     O veredito vem logo depois da situação: é a coluna que o auditor
     procura, não pode ser a última de uma tabela de 12 colunas. */
  document.querySelector("main").classList.toggle("largo", comp);
  $("caixa-tabela").classList.toggle("tabela-comp", comp);

  $("cabecalho").innerHTML =
    `<th style="width:34px"></th><th>Situação</th>` +
    (comp ? `<th>Veredito</th>` : "") +
    `<th>Código</th><th>Produto</th>` +
    (comp
      ? `<th class="col-crua" style="text-align:right">Sist. 1ª</th>
         <th class="col-crua" style="text-align:right">Cont. 1ª</th>
         <th style="text-align:right">Dif 1ª</th>
         <th class="col-saiu" style="text-align:right">Saiu</th>` : "") +
    `<th style="text-align:right">Sistema</th>
     <th style="text-align:right">Contado</th>
     <th style="text-align:right">Diferença</th>`;

  const colunas = comp ? 12 : 7;

  const visiveis = linhas
    .filter((l) => mostrarTudo || l.situacao !== "ok")
    .sort((a, b) => Math.abs(Number(b.diferenca || 0)) - Math.abs(Number(a.diferenca || 0)));

  const num = (v) => (v == null ? "—" : numeroBR(v));
  const corDif = (d) => `color:var(${d < 0 ? "--falta" : d > 0 ? "--sobra" : "--fraco"})`;

  $("corpo").innerHTML = visiveis.length
    ? visiveis.map((l) => {
        const r = ROTULOS[l.situacao];
        const d = Number(l.diferenca || 0);
        const c = comp ? comparar(l) : null;
        const d1 = c?.o ? Number(c.o.diferenca || 0) : null;
        // Produto sem código (Não Cadastrado) não pode ser recontado:
        // ele não existe no relatório de estoque.
        const podeRecontar = !!l.seqproduto;
        return `<tr class="l-${l.situacao}">
          <td>${podeRecontar
            ? `<input type="checkbox" class="marca" data-seq="${l.seqproduto}"
                 ${selecionados.has(String(l.seqproduto)) ? "checked" : ""}
                 style="width:20px;height:20px">`
            : ""}</td>
          <td><span class="selo ${r.cls}">${r.txt}</span></td>
          ${comp ? `<td><span class="selo ${VEREDITOS[c.chave].cls}">${
            VEREDITOS[c.chave].txt}</span></td>` : ""}
          <td class="num">${l.seqproduto ?? "—"}</td>
          <td>${l.descricao}</td>
          ${comp ? `
          <td class="num fraco col-crua">${c.o ? num(c.o.qtd_sistema) : "—"}</td>
          <td class="num fraco col-crua">${c.o ? num(c.o.qtd_contada) : "—"}</td>
          <td class="num" style="${d1 == null ? "" : corDif(d1)}">
            ${d1 == null ? "—" : (d1 > 0 ? "+" : "") + numeroBR(d1)}</td>
          <td class="num fraco col-saiu">${c.saiu == null ? "—" : numeroBR(c.saiu)}</td>` : ""}
          <td class="num">${l.qtd_sistema == null ? "—" : numeroBR(l.qtd_sistema)}</td>
          <td class="num">${numeroBR(l.qtd_contada)}</td>
          <td class="num" style="font-weight:700;${corDif(d)}">
            ${d > 0 ? "+" : ""}${numeroBR(d)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="${colunas}" class="fraco" style="padding:1.2rem">Nenhuma divergência. Tudo bateu.</td></tr>`;

  $("corpo").querySelectorAll(".marca").forEach((c) =>
    c.addEventListener("change", () => {
      if (c.checked) selecionados.add(c.dataset.seq);
      else selecionados.delete(c.dataset.seq);
      atualizarBotaoRecontar();
    }));
  atualizarBotaoRecontar();
}

/* ---------- recontagem ---------- */
const selecionados = new Set();

function atualizarBotaoRecontar() {
  const n = selecionados.size;
  $("btn-recontar").disabled = n === 0;
  $("btn-recontar").textContent = n === 0
    ? "Recontar selecionados"
    : `Recontar ${n} produto${n === 1 ? "" : "s"}`;
}

function marcarTodosDivergentes() {
  selecionados.clear();
  linhas.filter((l) => l.situacao !== "ok" && l.seqproduto)
        .forEach((l) => selecionados.add(String(l.seqproduto)));
  desenhar();
}

function limparSelecao() { selecionados.clear(); desenhar(); }

function irParaRecontagem() {
  if (!selecionados.size) return;
  sessionStorage.setItem("r400_recontagem", JSON.stringify({
    origemId: lote.id,
    origemNome: lote.nome,
    lojaId: lote.loja_id,
    lojaNome: lote.loja?.nome || "",
    seqs: [...selecionados],
  }));
  location.href = "importar.html";
}

/* ---------- Excel ---------- */
async function baixarExcel() {
  const b = $("btn-excel");
  b.disabled = true; b.textContent = "Montando…";
  try {
    await carregarExcelJS();
    const comp = comparativoLigado();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Divergências");

    const ultimaCol = comp ? "K" : "F";
    ws.mergeCells(`A1:${ultimaCol}1`);
    ws.getCell("A1").value = lote.nome;
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.mergeCells(`A2:${ultimaCol}2`);
    ws.getCell("A2").value =
      `Retrato do sistema: ${dataHoraBR(lote.retrato_em)}   ·   ` +
      `Fechado em: ${dataHoraBR(lote.fechado_em)}   ·   Loja: ${lote.loja?.nome || ""}` +
      (comp ? `   ·   Comparando com: ${origem.nome}` : "");
    ws.getCell("A2").font = { size: 10, color: { argb: "FF666666" } };

    const cab = comp
      ? ["Situação", "Veredito", "Código", "Produto",
         "Sist. 1ª", "Cont. 1ª", "Dif 1ª", "Saiu",
         "Sistema", "Contado", "Diferença"]
      : ["Situação", "Código", "Produto", "Qtd Sistema", "Qtd Contada", "Diferença"];
    ws.addRow([]);
    ws.addRow(cab);
    const rc = ws.lastRow;
    rc.font = { bold: true };
    rc.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF6" } };
      c.border = { bottom: { style: "thin", color: { argb: "FF9AA8B8" } } };
    });

    const ordem = { falta: 0, sobra: 1, nao_conferido: 2, nao_cadastrado: 3, ok: 4 };
    [...linhas]
      .sort((a, b2) => (ordem[a.situacao] - ordem[b2.situacao]) ||
                        (Math.abs(Number(b2.diferenca || 0)) - Math.abs(Number(a.diferenca || 0))))
      .forEach((l) => {
        const c = comp ? comparar(l) : null;
        const base = comp
          ? [ROTULOS[l.situacao].txt, VEREDITOS[c.chave].txt, l.seqproduto ?? "", l.descricao]
          : [ROTULOS[l.situacao].txt, l.seqproduto ?? "", l.descricao];
        const meio = comp ? [
          c.o && c.o.qtd_sistema != null ? Number(c.o.qtd_sistema) : "",
          c.o ? Number(c.o.qtd_contada || 0) : "",
          c.o ? Number(c.o.diferenca || 0) : "",
          c.saiu == null ? "" : Number(c.saiu),
        ] : [];
        const fim = [
          l.qtd_sistema == null ? "" : Number(l.qtd_sistema),
          Number(l.qtd_contada || 0),
          Number(l.diferenca || 0),
        ];
        const r = ws.addRow([...base, ...meio, ...fim]);
        const cor = ROTULOS[l.situacao].cor;
        r.eachCell((c2) => {
          c2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor } };
          c2.border = { bottom: { style: "hair", color: { argb: "FFCCCCCC" } } };
        });
        r.getCell(comp ? 11 : 6).font = { bold: true };   // Diferença
        if (comp) {
          r.getCell(2).fill = {                            // Veredito
            type: "pattern", pattern: "solid",
            fgColor: { argb: VEREDITOS[c.chave].cor },
          };
          r.getCell(2).font = { bold: true };
        }
      });

    ws.columns = comp
      ? [{ width: 16 }, { width: 22 }, { width: 11 }, { width: 42 },
         { width: 10 }, { width: 10 }, { width: 9 }, { width: 8 },
         { width: 10 }, { width: 10 }, { width: 11 }]
      : [{ width: 16 }, { width: 11 }, { width: 46 }, { width: 13 }, { width: 13 }, { width: 12 }];
    ws.views = [{ state: "frozen", ySplit: rc.number }];
    ws.autoFilter = { from: { row: rc.number, column: 1 },
                      to: { row: rc.number, column: cab.length } };

    const buf = await wb.xlsx.writeBuffer();
    const nome = lote.nome.replace(/[\\/:*?"<>|]/g, "-") + ".xlsx";
    const url = URL.createObjectURL(new Blob([buf],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    aviso("Não consegui montar o Excel: " + e.message);
  } finally {
    b.disabled = false; b.textContent = "Baixar Excel";
  }
}

function carregarExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((ok, erro) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    s.onload = ok;
    s.onerror = () => erro(new Error("precisa de internet para gerar o arquivo"));
    document.head.appendChild(s);
  });
}

$("btn-gerar").addEventListener("click", gerar);
$("btn-marcar-todos").addEventListener("click", marcarTodosDivergentes);
$("btn-desmarcar").addEventListener("click", limparSelecao);
$("btn-recontar").addEventListener("click", irParaRecontagem);
$("btn-excel").addEventListener("click", baixarExcel);
$("btn-comparativo").addEventListener("click", () => { mostrarComp = !mostrarComp; desenhar(); });
$("btn-tudo").addEventListener("click", () => {
  mostrarTudo = !mostrarTudo;
  $("btn-tudo").textContent = mostrarTudo ? "Mostrar só as divergências" : "Mostrar também os que bateram";
  desenhar();
});

carregar();
