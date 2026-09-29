/* =============================================
   cadastro.js — lojas, acessos e a situação do cadastro
   =============================================
   O cadastro de produtos não é mais carregado aqui. Ele é carregado no
   Contagens e chega pronto, em blocos, trocado de uma vez só no fim
   (funções cadastro_sinc_* no banco). Esta tela mostra o que chegou.
   ============================================= */
const $ = (id) => document.getElementById(id);
if (!exigirLogin()) throw new Error("sem login");

/* A carga de cadastro saiu daqui: quem carrega é o Contagens, que manda
   o cadastro pronto para cá no fim de cada carga (ver rotta400.js lá).
   Esta tela só mostra o que chegou. */

async function situacao() {
  try {
    const s = await rpc("cadastro_situacao");
    const quando = s.atualizado
      ? new Date(s.atualizado).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : "nunca";
    $("atual").innerHTML = s.linhas
      ? `<b>${numeroBR(s.linhas)} códigos</b> · ${numeroBR(s.produtos)} produtos · recebido em ${quando}`
      : "Nenhum cadastro ainda. Carregue no Contagens: ele manda para cá no fim.";
  } catch (e) {
    $("atual").textContent = "erro: " + e.message;
  }
}

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
