/* =============================================
   pwa.js — registra o Service Worker e cuida da ATUALIZAÇÃO
   =============================================
   O Service Worker é o que faz o app abrir sem internet. O problema de
   sempre: depois de publicar uma versão nova, o navegador continua
   entregando a antiga até o usuário fechar todas as abas do site. Era
   por isso que só um Ctrl+Shift+R resolvia.

   Aqui a troca acontece sozinha:
   - o arquivo sw.js é buscado sem passar pelo cache do navegador
     (updateViaCache: "none"), então uma versão nova é notada de verdade;
   - o app pergunta se há versão nova ao abrir, ao voltar para a aba e
     de 15 em 15 minutos;
   - quando a versão nova assume, a página recarrega sozinha UMA vez.

   Exceção: a tela de contagem NÃO recarrega sozinha. Recarregar no meio
   de um inventário atrapalharia o gerente, então ali aparece uma barra
   e ele atualiza quando quiser. As contagens ficam no aparelho, não se
   perdem de qualquer jeito.

   IMPORTANTE para quem for publicar: a troca só acontece se o conteúdo
   do sw.js mudar. Sempre suba o número de VERSAO lá dentro.
   ============================================= */
if ("serviceWorker" in navigator) {
  const naContagem = /contar\.html$/i.test(location.pathname);
  const jaTinhaVersao = !!navigator.serviceWorker.controller;
  let tratado = false;

  function barraDeAtualizacao() {
    if (document.getElementById("barra-atualizar")) return;
    const b = document.createElement("div");
    b.id = "barra-atualizar";
    b.style.cssText =
      "position:fixed;left:0;right:0;top:0;z-index:9999;display:flex;gap:.7rem;" +
      "align-items:center;justify-content:center;padding:.5rem .8rem;" +
      "background:#1a6fd4;color:#fff;font:600 .85rem system-ui,sans-serif;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.35)";
    b.innerHTML =
      '<span>Nova versão do site disponível.</span>' +
      '<button type="button" style="font:inherit;border:0;border-radius:7px;' +
      'padding:.3rem .8rem;cursor:pointer;background:#fff;color:#1a6fd4">Atualizar</button>';
    b.querySelector("button").addEventListener("click", () => location.reload());
    document.body.appendChild(b);
  }

  function versaoNovaAssumiu() {
    if (tratado) return;
    tratado = true;
    if (naContagem) barraDeAtualizacao();
    else location.reload();
  }

  // Só vale quando JÁ existia uma versão rodando. Na primeira visita o
  // Service Worker assume o controle normalmente e recarregar seria à toa.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (jaTinhaVersao) versaoNovaAssumiu();
  });

  window.addEventListener("load", async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    } catch { return; }

    const procurarAtualizacao = () => { reg.update().catch(() => {}); };

    procurarAtualizacao();
    setInterval(procurarAtualizacao, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) procurarAtualizacao();
    });
    window.addEventListener("online", procurarAtualizacao);

    // Se o navegador segurar a versão nova em espera, manda assumir.
    // O sw.js já chama skipWaiting(), isto é só o cinto de segurança.
    const cutucar = () => {
      if (reg.waiting && jaTinhaVersao) reg.waiting.postMessage({ tipo: "assumir" });
    };
    cutucar();
    reg.addEventListener("updatefound", () => {
      const novo = reg.installing;
      if (!novo) return;
      novo.addEventListener("statechange", () => {
        if (novo.state === "installed") cutucar();
      });
    });
  });
}
