/* =============================================
   cadastro.js — carga do CSV direto do navegador
   =============================================
   O arquivo tem ~20 MB e ~148 mil linhas. Ele é lido
   no computador do auditor e enviado em blocos.
   ============================================= */
const $ = (id) => document.getElementById(id);
if (!exigirLogin()) throw new Error("sem login");

const BLOCO = 1500;
let linhasPreparadas = null;

// "7,89199E+12" -> "7891990000000"
function normalizarCodigo(v) {
  const s = String(v || "").trim().replace(",", ".");
  if (!s) return "";
  if (!/[Ee]/.test(s)) return s;
  try { return BigInt(Math.round(Number(s))).toString(); } catch { return s; }
}

async function situacao() {
  try {
    const c = await api("cadastro_carga?select=carregado_em,linhas&order=carregado_em.desc&limit=1");
    $("atual").innerHTML = c?.length
      ? `<b>${numeroBR(c[0].linhas)} códigos</b> · última carga em ${dataHoraBR(c[0].carregado_em)}`
      : "Nenhuma carga feita ainda.";
  } catch (e) { $("atual").textContent = "erro: " + e.message; }
}

$("arquivo").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  $("previa").classList.remove("oculto");
  $("previa").innerHTML = `<div class="nota nota--info">Lendo o arquivo…</div>`;
  $("btn-subir").disabled = true;

  try {
    const texto = await f.text();
    const linhas = texto.split(/\r?\n/);
    const cab = linhas[0].split(";").map((c) => c.trim().toUpperCase());
    const iSeq = cab.indexOf("SEQPRODUTO");
    const iCod = cab.indexOf("CODACESSO");
    const iDes = cab.indexOf("DESCCOMPLETA");
    const iQtd = cab.indexOf("QTDEMBALAGEM");
    const iNiveis = cab.map((c, k) => (/^NIVEL \d$/.test(c) ? k : -1)).filter((k) => k >= 0);

    if (iSeq < 0 || iCod < 0 || iDes < 0) {
      throw new Error(`O arquivo precisa das colunas SEQPRODUTO, CODACESSO e DESCCOMPLETA. Vieram: ${cab.slice(0,8).join(", ")}`);
    }

    const vistos = new Set();
    const saida = [];
    let semEan = 0, repetidos = 0;

    for (let k = 1; k < linhas.length; k++) {
      const l = linhas[k];
      if (!l.trim()) continue;
      const c = l.split(";");
      const ean = normalizarCodigo(c[iCod]);
      const seq = String(c[iSeq] || "").trim();
      if (!seq) continue;
      if (!ean) { semEan++; continue; }
      const chave = ean + "|" + seq;
      if (vistos.has(chave)) { repetidos++; continue; }
      vistos.add(chave);

      const niveis = [];
      for (const n of iNiveis) { const v = (c[n] || "").trim(); if (!v) break; niveis.push(v); }

      saida.push({
        seqproduto: seq,
        ean,
        descricao: (c[iDes] || "").trim().toUpperCase().slice(0, 200),
        qtd_embalagem: Number(String(c[iQtd] || "1").replace(",", ".")) || 1,
        categoria: niveis.join(" > ") || null,
      });
    }

    linhasPreparadas = saida;
    const produtos = new Set(saida.map((s) => s.seqproduto)).size;
    $("previa").innerHTML = `<div class="nota nota--ok">
      <b>${numeroBR(saida.length)} códigos de barras · ${numeroBR(produtos)} produtos</b>
      <span>${repetidos ? numeroBR(repetidos) + " linhas repetidas ignoradas · " : ""}${
        semEan ? numeroBR(semEan) + " linhas sem código de barras ignoradas" : "nenhuma linha descartada"}</span></div>`;
    $("btn-subir").disabled = false;
  } catch (err) {
    linhasPreparadas = null;
    $("previa").innerHTML = `<div class="nota nota--erro">${err.message}</div>`;
  }
});

$("btn-subir").addEventListener("click", async () => {
  if (!linhasPreparadas?.length) return;
  const b = $("btn-subir");
  b.disabled = true;
  $("cx-barra").classList.remove("oculto");
  const t0 = Date.now();

  try {
    $("andamento").textContent = "limpando o cadastro anterior…";
    await rpc("limpar_cadastro");

    for (let k = 0; k < linhasPreparadas.length; k += BLOCO) {
      const parte = linhasPreparadas.slice(k, k + BLOCO);
      await api("cadastro", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(parte),
      });
      const feito = Math.min(k + BLOCO, linhasPreparadas.length);
      const pct = (feito / linhasPreparadas.length) * 100;
      $("barra").style.width = pct.toFixed(1) + "%";
      const seg = (Date.now() - t0) / 1000;
      const falta = Math.round((seg / feito) * (linhasPreparadas.length - feito));
      $("andamento").textContent =
        `${numeroBR(feito)} de ${numeroBR(linhasPreparadas.length)} · ${pct.toFixed(0)}%` +
        (falta > 5 ? ` · faltam cerca de ${falta > 60 ? Math.ceil(falta / 60) + " min" : falta + " s"}` : "");
    }

    await api("cadastro_carga", { method: "POST",
      body: JSON.stringify({ linhas: linhasPreparadas.length }) });

    $("andamento").innerHTML = `<div class="nota nota--ok"><b>Cadastro atualizado.</b>
      <span>${numeroBR(linhasPreparadas.length)} códigos em ${Math.round((Date.now() - t0) / 1000)} segundos.</span></div>`;
    situacao();
  } catch (e) {
    $("andamento").innerHTML = `<div class="nota nota--erro"><b>Parou no meio: ${e.message}</b>
      <span>O cadastro pode estar incompleto. Rode a carga de novo.</span></div>`;
  } finally {
    b.disabled = false;
  }
});

$("btn-vincular").addEventListener("click", async () => {
  const r = $("res-vinculo");
  r.textContent = "vinculando…";
  try {
    const saida = await rpc("vincular_perfil", {
      p_email: $("v-email").value.trim(),
      p_papel: $("v-papel").value,
      p_loja_codigo: $("v-loja").value.trim() || null,
    });
    r.textContent = saida;
  } catch (e) { r.textContent = "erro: " + e.message; }
});

$("btn-loja").addEventListener("click", async () => {
  const r = $("res-loja");
  r.textContent = "salvando…";
  try {
    r.textContent = await rpc("criar_loja", {
      p_codigo: $("l-codigo").value.trim(),
      p_nome: $("l-nome").value.trim(),
    });
    localStorage.removeItem("r400_lojas");   // a lista do login recarrega
  } catch (e) { r.textContent = "erro: " + e.message; }
});

situacao();
