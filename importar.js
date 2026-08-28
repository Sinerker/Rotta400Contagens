/* =============================================
   importar.js — lê a colagem da Análise ABC,
   confere contra o TOTAL do sistema e cria o lote
   ============================================= */
const $ = (id) => document.getElementById(id);
if (!exigirLogin()) throw new Error("sem login");

let analise = null;

/* ---------- números no formato brasileiro ---------- */
// "4.905,000" -> 4905    "389,000" -> 389
function numBR(txt) {
  const s = String(txt || "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  return Number(s.replace(/\./g, "").replace(",", "."));
}

/* ---------- leitura da colagem ---------- */
function lerColagem(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  const itens = [];
  let totalDeclarado = null, linhasDeclaradas = null, cabecalho = false;
  const problemas = [];

  for (const linha of linhas) {
    const c = linha.split("\t");
    const cod = (c[0] || "").trim();

    // linha de cabeçalho
    if (/c[óo]digo/i.test(cod)) { cabecalho = true; continue; }

    // linha do TOTAL — vira conferência, não é descartada
    if (!cod) {
      const m = /TOTAL:\s*(\d+)\s*linhas/i.exec(linha);
      if (m) linhasDeclaradas = Number(m[1]);
      const t = numBR(c[3]);
      if (!Number.isNaN(t)) totalDeclarado = t;
      continue;
    }

    if (!/^\d+$/.test(cod)) { problemas.push(`código inválido: “${cod}”`); continue; }

    const qtd = numBR(c[3]);
    if (Number.isNaN(qtd)) { problemas.push(`quantidade ilegível no código ${cod}`); continue; }

    itens.push({
      seq: cod,
      desc: (c[1] || "").trim().toUpperCase(),
      emb: (c[2] || "").trim(),
      qtd,
    });
  }

  // código repetido no relatório: soma e avisa
  const porSeq = new Map();
  for (const i of itens) {
    if (porSeq.has(i.seq)) {
      porSeq.get(i.seq).qtd += i.qtd;
      problemas.push(`código ${i.seq} apareceu mais de uma vez — as quantidades foram somadas`);
    } else porSeq.set(i.seq, { ...i });
  }

  const finais = [...porSeq.values()];
  const soma = finais.reduce((a, i) => a + i.qtd, 0);

  return { itens: finais, soma, totalDeclarado, linhasDeclaradas, cabecalho, problemas };
}

/* ---------- conferência ---------- */
async function conferir() {
  const b = $("btn-conferir");
  b.disabled = true; b.textContent = "Conferindo…";
  const alvo = $("resultado");
  $("passo3").classList.remove("oculto");
  alvo.innerHTML = `<p class="fraco">consultando o cadastro…</p>`;
  $("btn-criar").disabled = true;

  const r = lerColagem($("colagem").value);
  const notas = [];
  let bloqueia = false;

  if (!r.itens.length) {
    alvo.innerHTML = `<div class="nota nota--erro"><b>Nada foi lido.</b>
      <span>Confira se você copiou as linhas da grade, com as quatro colunas.</span></div>`;
    b.disabled = false; b.textContent = "Conferir";
    return;
  }

  /* --- checksum do próprio sistema --- */
  const okLinhas = r.linhasDeclaradas == null || r.linhasDeclaradas === r.itens.length;
  const okTotal  = r.totalDeclarado  == null || Math.abs(r.totalDeclarado - r.soma) < 0.001;

  if (r.linhasDeclaradas == null && r.totalDeclarado == null) {
    notas.push(`<div class="nota nota--alerta"><b>A linha “TOTAL” não veio na colagem.</b>
      <span>Dá para seguir, mas sem ela não consigo garantir que o relatório veio inteiro.
      Se puder, copie incluindo a linha de total.</span></div>`);
  } else if (okLinhas && okTotal) {
    notas.push(`<div class="nota nota--ok"><b>Confere com o sistema.</b>
      <span>${r.itens.length} produtos · total ${numeroBR(r.soma)} UN,
      igual ao que o relatório declara.</span></div>`);
  } else {
    bloqueia = true;
    notas.push(`<div class="nota nota--erro"><b>A colagem não bate com o relatório.</b>
      <span>Li ${r.itens.length} produtos somando ${numeroBR(r.soma)} UN, mas o relatório declara
      ${r.linhasDeclaradas ?? "?"} linhas e ${numeroBR(r.totalDeclarado ?? 0)} UN.
      Provavelmente a cópia veio pela metade — selecione tudo de novo e cole outra vez.</span></div>`);
  }

  /* --- casamento com o cadastro --- */
  let achados = new Map();
  try {
    // busca em blocos para não estourar o tamanho da URL
    const seqs = r.itens.map((i) => i.seq);
    for (let k = 0; k < seqs.length; k += 300) {
      const bloco = seqs.slice(k, k + 300);
      const lista = await api(
        `cadastro?select=seqproduto,ean,qtd_embalagem&seqproduto=in.(${bloco.join(",")})`);
      for (const c of lista) {
        if (!achados.has(c.seqproduto)) achados.set(c.seqproduto, []);
        achados.get(c.seqproduto).push(c);
      }
    }
  } catch (e) {
    alvo.innerHTML = `<div class="nota nota--erro">Não consegui consultar o cadastro: ${e.message}</div>`;
    b.disabled = false; b.textContent = "Conferir";
    return;
  }

  const semEan = r.itens.filter((i) => !achados.has(i.seq));
  const comMulti = r.itens.filter((i) => (achados.get(i.seq) || []).some((c) => Number(c.qtd_embalagem) !== 1));

  if (semEan.length === 0) {
    notas.push(`<div class="nota nota--ok"><b>${r.itens.length} de ${r.itens.length} produtos
      encontrados no cadastro.</b></div>`);
  } else {
    notas.push(`<div class="nota nota--alerta">
      <b>${semEan.length} de ${r.itens.length} produtos não têm código de barras no cadastro.</b>
      <span>Eles entram no inventário, mas no coletor só podem ser achados pelo nome.
      <a href="#" id="ver-semean">Ver a lista</a></span></div>`);
  }

  if (comMulti.length) {
    notas.push(`<div class="nota nota--info">
      <b>${comMulti.length} produtos têm mais de uma embalagem</b> (unidade e pacote fechado).
      <span>No coletor, o gerente digita a quantidade que enxerga.
      A conversão para unidades acontece só na hora de comparar.</span></div>`);
  }

  if (r.problemas.length) {
    notas.push(`<div class="nota nota--alerta"><b>Observações na leitura</b>
      <span>${[...new Set(r.problemas)].slice(0, 6).join("<br>")}</span></div>`);
  }

  alvo.innerHTML = notas.join("");
  $("ver-semean")?.addEventListener("click", (e) => { e.preventDefault(); abrirSemEan(semEan); });

  analise = { ...r, semEan: new Set(semEan.map((i) => i.seq)) };
  $("nome").value = sugerirNome(r.itens);
  $("btn-criar").disabled = bloqueia;
  if (bloqueia) $("btn-criar").title = "Corrija a colagem antes de criar";

  b.disabled = false; b.textContent = "Conferir de novo";
}

/* ---------- nome sugerido ---------- */
function sugerirNome(itens) {
  const p = perfil();
  const loja = p?.loja?.nome || "LOJA";
  // primeira palavra mais comum das descrições, como pista da categoria
  const cont = {};
  itens.forEach((i) => { const w = (i.desc.split(/\s+/)[0] || ""); if (w.length > 2) cont[w] = (cont[w] || 0) + 1; });
  const cat = Object.entries(cont).sort((a, b) => b[1] - a[1])[0]?.[0] || "INVENTARIO";
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${cat} · ${loja} · ${dd}/${mm} ${hh}:${mi}`;
}

function abrirSemEan(lista) {
  $("lista-semean").innerHTML = lista.map((i) => `
    <div class="item"><span class="item-desc">${i.desc}</span>
    <span class="item-info">código ${i.seq} · estoque ${numeroBR(i.qtd)}</span></div>`).join("");
  $("modal-semean").classList.add("aberto");
}
$("fechar-semean").addEventListener("click", () => $("modal-semean").classList.remove("aberto"));
$("modal-semean").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("aberto");
});

/* ---------- criar o lote ---------- */
async function criar() {
  if (!analise) return;
  const b = $("btn-criar");
  b.disabled = true; b.textContent = "Criando…";
  try {
    const p = perfil();
    const [lote] = await api("lote", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        loja_id: p.loja_id,
        nome: $("nome").value.trim() || sugerirNome(analise.itens),
        retrato_em: new Date().toISOString(),
        linhas_declaradas: analise.linhasDeclaradas ?? analise.itens.length,
        total_declarado: analise.totalDeclarado ?? analise.soma,
      }),
    });

    const itens = analise.itens.map((i) => ({
      lote_id: lote.id, seqproduto: i.seq, descricao: i.desc,
      qtd_sistema: i.qtd, sem_ean: analise.semEan.has(i.seq),
    }));
    for (let k = 0; k < itens.length; k += 500) {
      await api("lote_item", { method: "POST", body: JSON.stringify(itens.slice(k, k + 500)) });
    }

    sessionStorage.setItem("r400_lote", lote.id);
    aviso("Inventário criado. Abra no coletor.", "ok");
    setTimeout(() => { location.href = "index.html"; }, 900);
  } catch (e) {
    aviso(e.message);
    b.disabled = false; b.textContent = "Criar inventário";
  }
}

/* ---------- ligações ---------- */
// Cola em QUALQUER lugar da tela, não só dentro da caixa.
document.addEventListener("paste", (e) => {
  const texto = (e.clipboardData || window.clipboardData)?.getData("text");
  if (!texto) return;
  if (e.target !== $("colagem")) {
    e.preventDefault();
    $("colagem").value = texto;
  }
  $("btn-conferir").disabled = false;
  setTimeout(conferir, 50);
});

// Botão para quem não usa atalho de teclado
$("btn-colar").addEventListener("click", async () => {
  const erro = $("erro-colar");
  erro.classList.add("oculto");
  try {
    const texto = await navigator.clipboard.readText();
    if (!texto.trim()) throw new Error("A área de transferência está vazia. Copie o relatório no sistema primeiro.");
    $("colagem").value = texto;
    $("btn-conferir").disabled = false;
    conferir();
  } catch (e) {
    erro.textContent = e.name === "NotAllowedError"
      ? "O navegador não deixou ler a área de transferência. Clique dentro da caixa e use Ctrl+V."
      : e.message;
    erro.classList.remove("oculto");
    $("colagem").focus();
  }
});

$("colagem").addEventListener("input", () => {
  $("btn-conferir").disabled = !$("colagem").value.trim();
});
$("btn-conferir").addEventListener("click", conferir);
$("btn-limpar").addEventListener("click", () => {
  $("colagem").value = "";
  $("passo3").classList.add("oculto");
  $("erro-colar").classList.add("oculto");
  analise = null;
  $("btn-conferir").disabled = true;
  $("colagem").focus();
});
$("btn-criar").addEventListener("click", criar);

(async () => {
  try { const p = (await carregarPerfil()) || perfil(); $("sub").textContent = p?.loja?.nome || "—"; }
  catch { $("sub").textContent = perfil()?.loja?.nome || "—"; }
  $("colagem").focus();
})();
