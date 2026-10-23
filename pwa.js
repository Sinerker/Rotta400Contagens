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

   Exceção: a tela de contagem não recarrega NA HORA. Recarregar no meio
   de um bipe perderia o que está na tela, então ali ela espera a hora
   boa: o contar.js responde em window.podeRecarregar() se a tela está
   limpa, se não há contagem pendente de envio e se o aparelho está
   parado há dois minutos. Enquanto isso aparece uma barra, para quem
   quiser atualizar na hora. As contagens ficam no aparelho de qualquer
   jeito, nada se perde.

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
      '<span>Nova versão disponível — entra sozinha quando você parar.</span>' +
      '<button type="button" style="font:inherit;border:0;border-radius:7px;' +
      'padding:.3rem .8rem;cursor:pointer;background:#fff;color:#1a6fd4">Atualizar</button>';
    b.querySelector("button").textContent = "Atualizar agora";
    b.querySelector("button").addEventListener("click", () => location.reload());
    document.body.appendChild(b);
  }

  // Na tela de contagem, espera o contar.js dizer que dá. Se a página não
  // tiver essa resposta (contar.js antigo no cache), não recarrega sozinha:
  // fica só a barra, como era antes.
  function esperarHoraBoa() {
    setInterval(() => {
      if (typeof window.podeRecarregar === "function" && window.podeRecarregar())
        location.reload();
    }, 5000);
  }

  function versaoNovaAssumiu() {
    if (tratado) return;
    tratado = true;
    if (!naContagem) { location.reload(); return; }
    barraDeAtualizacao();
    esperarHoraBoa();
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
