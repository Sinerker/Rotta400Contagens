# Contagens ROTTA400

Inventário por loja: o relatório de estoque define o que contar,
o coletor conta offline, e o Excel de divergências sai pronto — sem macro.

## Como funciona

1. **No computador** — o gerente cola o resultado da Análise ABC (Ctrl+V).
   O site confere contra a linha `TOTAL: N linhas` do próprio relatório,
   procura os produtos no cadastro e cria o inventário.
2. **No coletor** — o aparelho baixa só os produtos daquele inventário
   (alguns KB, não os 20 MB do cadastro inteiro) e conta offline.
   A quantidade do sistema **nunca** é enviada para o coletor.
3. **No computador de novo** — fecha o inventário e gera o Excel colorido
   com Falta, Sobra, Não Conferido e Não Cadastrado.

## Login

O gerente **não digita e-mail**. Ele escolhe a loja numa lista e digita a senha.

O Supabase exige um identificador de usuário, então o app monta um por dentro,
sempre no mesmo padrão: `loja<código>@rotta400.app`. A loja 304 usa
`loja304@rotta400.app`. Esse endereço não existe e nunca recebe nada — é só
um nome de usuário com formato de e-mail. Por isso os usuários precisam ser
criados no painel do Supabase com **Auto Confirm** marcado.

O auditor entra pelo link "Sou o auditor", digitando o e-mail direto.

## Regras que o código não quebra

- **Contagem cega.** O coletor não recebe `qtd_sistema`. Quem conta não vê o esperado.
- **Offline é o normal, não a exceção.** Toda contagem grava no IndexedDB primeiro.
  O envio é consequência. Sem sinal, o trabalho continua.
- **Quantidade crua.** A tabela guarda exatamente o que foi digitado.
  A multiplicação pela embalagem acontece só na comparação,
  dentro de `divergencia_lote()`.
- **Nada é sobrescrito.** Correção entra como registro novo apontando
  para o anterior (`cancela_id`). A trilha fica inteira.
- **A quantidade nunca vem pré-preenchida.** Ao recontar um produto,
  o total já lançado aparece como aviso — nunca dentro do campo.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` / `index.js` | Login e lista de inventários |
| `importar.html` / `importar.js` | Colagem do relatório, checksum e criação do lote |
| `contar.html` / `contar.js` | Tela do coletor |
| `local.js` | Banco do aparelho (IndexedDB) e fila de envio |
| `divergencias.html` / `divergencias.js` | Fechamento, tabela e Excel |
| `cadastro.html` / `cadastro.js` | Carga semanal do CSV e vínculo de acessos (só auditor) |
| `api.js` | Login e chamadas ao banco, sem biblioteca externa |
| `sw.js` | Service Worker — faz o app abrir sem internet |

## Banco

Supabase, projeto `Rotta400Contagens`. Sete tabelas com RLS:
cada loja só enxerga o que é dela. O auditor enxerga tudo.

Funções: `pacote_lote`, `divergencia_lote`, `fechar_lote`,
`limpar_cadastro`, `vincular_perfil`, `criar_loja`.

## Publicar

Repositório no GitHub → Settings → Pages → branch `main`, pasta `/`.
Precisa ser HTTPS para o Service Worker funcionar; o GitHub Pages já é.
