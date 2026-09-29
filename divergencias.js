/* =============================================
   divergencias.js — fecha o lote e monta o relatório
   =============================================
   A conversão pela embalagem acontece no banco,
   dentro de divergencia_lote(). Aqui só apresenta.
   ============================================= */
const $ = (id) => document.getElementById(id);
if (!exigirLogin()) throw new Error("sem login");

const loteId = sessionStorage.getItem("r400_lote");
let lote = null, linhas = [], mostrarTudo = false;

const ROTULOS = {
  falta:          { txt: "Falta",          cls: "selo--falta", cor: "FFF4D3D0" },
  sobra:          { txt: "Sobra",          cls: "selo--sobra", cor: "FFD4EDDB" },
  nao_conferido:  { txt: "Não Conferido",  cls: "selo--nconf", cor: "FFFAF0CC" },
  nao_cadastrado: { txt: "Não Cadastrado", cls: "selo--ncad",  cor: "FFD6E6F8" },
  ok:             { txt: "Confere",        cls: "selo--ok",    cor: "FFFFFFFF" },
};

async function carregar() {
  if (!loteId) { location.href = "index.html"; return; }
  const [l] = await api(`lote?select=*,loja(nome)&id=eq.${loteId}`);
  if (!l) { aviso("Inventário não encontrado"); return; }
  lote = l;
  $("lote-nome").textContent = l.nome;
  $("lote-sub").textContent = l.loja?.nome || "";

  const itens = await api(`lote_item?select=seqproduto&lote_id=eq.${loteId}`);
  const cont  = await api(`contagem?select=seqproduto,cancela_id&lote_id=eq.${loteId}&limit=20000`);
  const canceladas = new Set(cont.filter((c) => c.cancela_id).map((c) => c.cancela_id));
  const contados = new Set(cont.filter((c) => !c.cancela_id && c.seqproduto).map((c) => c.seqproduto));
  const feitos = [...contados].filter((s) => itens.some((i) => i.seqproduto === s)).length;

  $("situacao").innerHTML = `
    ${feitos} de ${itens.length} produtos contados ·
    retrato do sistema em <b>${dataHoraBR(l.retrato_em)}</b>
    ${l.status === "fechado" ? `<br>Fechado em <b>${dataHoraBR(l.fechado_em)}</b>` : ""}`;

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
    desenhar();
    $("caixa-res").style.display = "flex";
    $("caixa-fechar").classList.add("oculto");
  } catch (e) {
    aviso(e.message);
    b.disabled = false; b.textContent = "Fechar e gerar divergências";
  }
}

function desenhar() {
  const cont = { falta: 0, sobra: 0, nao_conferido: 0, nao_cadastrado: 0, ok: 0 };
  linhas.forEach((l) => { cont[l.situacao] = (cont[l.situacao] || 0) + 1; });

  $("placar").innerHTML = ["falta", "sobra", "nao_conferido", "nao_cadastrado", "ok"]
    .map((k) => `<div class="p"><span class="v" style="color:var(${
      k === "falta" ? "--falta" : k === "sobra" ? "--sobra" :
      k === "nao_conferido" ? "--atencao" : k === "nao_cadastrado" ? "--info" : "--fraco"
    })">${cont[k] || 0}</span><span class="k">${ROTULOS[k].txt}</span></div>`).join("");

  const visiveis = linhas
    .filter((l) => mostrarTudo || l.situacao !== "ok")
    .sort((a, b) => Math.abs(Number(b.diferenca || 0)) - Math.abs(Number(a.diferenca || 0)));

  $("corpo").innerHTML = visiveis.length
    ? visiveis.map((l) => {
        const r = ROTULOS[l.situacao];
        const d = Number(l.diferenca || 0);
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
          <td class="num">${l.seqproduto ?? "—"}</td>
          <td>${l.descricao}</td>
          <td class="num">${l.qtd_sistema == null ? "—" : numeroBR(l.qtd_sistema)}</td>
          <td class="num">${numeroBR(l.qtd_contada)}</td>
          <td class="num" style="font-weight:700;color:var(${d < 0 ? "--falta" : d > 0 ? "--sobra" : "--fraco"})">
            ${d > 0 ? "+" : ""}${numeroBR(d)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="7" class="fraco" style="padding:1.2rem">Nenhuma divergência. Tudo bateu.</td></tr>`;

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
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Divergências");

    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = lote.nome;
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.mergeCells("A2:F2");
    ws.getCell("A2").value =
      `Retrato do sistema: ${dataHoraBR(lote.retrato_em)}   ·   ` +
      `Fechado em: ${dataHoraBR(lote.fechado_em)}   ·   Loja: ${lote.loja?.nome || ""}`;
    ws.getCell("A2").font = { size: 10, color: { argb: "FF666666" } };

    const cab = ["Situação", "Código", "Produto", "Qtd Sistema", "Qtd Contada", "Diferença"];
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
        const r = ws.addRow([
          ROTULOS[l.situacao].txt,
          l.seqproduto ?? "",
          l.descricao,
          l.qtd_sistema == null ? "" : Number(l.qtd_sistema),
          Number(l.qtd_contada || 0),
          Number(l.diferenca || 0),
        ]);
        const cor = ROTULOS[l.situacao].cor;
        r.eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor } };
          c.border = { bottom: { style: "hair", color: { argb: "FFCCCCCC" } } };
        });
        r.getCell(6).font = { bold: true };
      });

    ws.columns = [{ width: 16 }, { width: 11 }, { width: 46 }, { width: 13 }, { width: 13 }, { width: 12 }];
    ws.views = [{ state: "frozen", ySplit: rc.number }];
    ws.autoFilter = { from: { row: rc.number, column: 1 }, to: { row: rc.number, column: 6 } };

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
$("btn-tudo").addEventListener("click", () => {
  mostrarTudo = !mostrarTudo;
  $("btn-tudo").textContent = mostrarTudo ? "Mostrar só as divergências" : "Mostrar também os que bateram";
  desenhar();
});

carregar();
