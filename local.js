/* =============================================
   local.js — banco do aparelho (IndexedDB)
   =============================================
   Toda contagem é gravada AQUI primeiro. O envio
   para o servidor é consequência, nunca condição.
   Sem sinal, o trabalho continua igual.
   ============================================= */

const DB_NOME = "Rotta400Local";

function abrirLocal() {
  return new Promise((ok, erro) => {
    const req = indexedDB.open(DB_NOME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pacotes"))
        db.createObjectStore("pacotes", { keyPath: "loteId" });
      if (!db.objectStoreNames.contains("contagens")) {
        const s = db.createObjectStore("contagens", { keyPath: "id" });
        s.createIndex("porLote", "lote_id", { unique: false });
      }
    };
    req.onsuccess = (e) => ok(e.target.result);
    req.onerror = (e) => erro(e.target.error);
    // se outra aba segurar uma versão antiga, avisa em vez de travar para sempre
    req.onblocked = () => erro(new Error("Feche as outras abas do Contagens e tente de novo"));
  });
}

async function comStore(nome, modo, fn) {
  const db = await abrirLocal();
  return new Promise((ok, erro) => {
    const tx = db.transaction([nome], modo);
    const r = fn(tx.objectStore(nome));
    tx.oncomplete = () => { db.close(); ok(r && "result" in r ? r.result : r); };
    tx.onerror = () => { db.close(); erro(tx.error); };
  });
}

const salvarPacote   = (p)  => comStore("pacotes", "readwrite", (s) => s.put(p));
const lerPacote      = (id) => comStore("pacotes", "readonly",  (s) => s.get(id));
const gravarContagem = (c)  => comStore("contagens", "readwrite", (s) => s.put(c));
const apagarContagem = (id) => comStore("contagens", "readwrite", (s) => s.delete(id));

const contagensDoLote = (loteId) =>
  comStore("contagens", "readonly", (s) => s.index("porLote").getAll(loteId));

async function gravarVarias(lista) {
  const db = await abrirLocal();
  return new Promise((ok, erro) => {
    const tx = db.transaction(["contagens"], "readwrite");
    const s = tx.objectStore("contagens");
    lista.forEach((c) => s.put(c));
    tx.oncomplete = () => { db.close(); ok(); };
    tx.onerror = () => { db.close(); erro(tx.error); };
  });
}

function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
