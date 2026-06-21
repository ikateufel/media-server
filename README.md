# video_player

Aplicação web (Nuxt 3) para **reproduzir bibliotecas de vídeo** a partir do disco da máquina onde corre o servidor Node. O browser só faz streaming via HTTP; os ficheiros vivem em pastas configuradas no servidor (por exemplo `VIDEO_ROOT` ou `data/video-menu.json`).

## Requisitos

- **Node.js** ≥ 22.13 (ver `package.json` → `engines`)
- **npm** (ou compatível)
- **Windows** no servidor para: jobs Admin de **trailer.bat / preview.bat**, botão «Explorador» e scripts `.bat` herdados pelo sync

## Estrutura de cada biblioteca (VIDEO_ROOT)

Dentro da raiz de cada biblioteca:

| Local | Conteúdo |
|--------|-----------|
| **Raiz** (e subpastas directas suportadas pelo catálogo) | Vídeo **completo** (ex.: `Filme.mp4`) |
| **`trailers/`** | Trailer acelerado (mesmo *stem* que o filme; ver regras em `server/utils/trailerNames.ts`) |
| **`preview/`** | Preview em vídeo (opcional; alinhado com o trailer) |
| **`.thumb_cache/`** | Miniaturas em cache (geradas pelo app) |

Há suporte a **várias bibliotecas** (várias raízes) e vistas especiais no UI (ex.: Destaques, Busca). Tags e progresso ficam em SQLite / JSON local em `data/` (ver abaixo).

## Instalação

```bash
npm install
```

Copie a configuração de ambiente de exemplo e ajuste:

```bash
cp .env.example .env
```

Edite `VIDEO_ROOT` (caminho **absoluto** no **servidor**, não no PC que abre o browser).

Opcional: **[várias pastas no menu]** — copie `data/video-menu.example.json` para `data/video-menu.json` e preencha `items` com `{ "path", "title" }`. Se esse JSON for válido, **substitui** a ordem / lista definida só por `VIDEO_ROOT`.

## Variáveis de ambiente (resumo)

- **`VIDEO_ROOT`** — raiz da biblioteca (ou use `data/video-menu.json` para várias entradas).
- **`VIDEO_ADMIN_TOKEN`** — token para APIs Admin e página `/admin` (também aceite como `NUXT_ADMIN_TOKEN` no runtime Nuxt → `runtimeConfig.adminToken`).
- Outras opções (tags automáticas, temp dos `.bat`, host/porta) estão comentadas em **`.env.example`**.

## Comandos

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento Nuxt |
| `npm run build` | Build de produção |
| `npm run start` | Arranca o servidor built (usa `.env` se existir) |
| `npm run auto-tags` | Pipeline de tags automáticas (export → Python → import SQLite) |
| `npm run warm-preview-cache` | Pré-gera miniaturas do catálogo |
| `npm run refresh-thumbs` | Limpa caches de thumbs e volta a aquecer |

Lista completa: ver `package.json` → `scripts`.

## trailer.bat no Windows

O script **distribui** cortes pelo filme e junta-os com aceleração ~2× (`setpts`/áudio em `scripts/trailer.bat`).

**Único processamento padrão** (`trailer.bat`, Admin, `trailer-1min.bat`, `trailer-2min.bat`) — **15 s** em 2×:
- vídeos **≤ 60 min**: a cada **5 %** do filme (0 %, 5 %, …, 95 %);
- vídeos **> 60 min**: a cada **5 min** (0 min, 5 min, 10 min, …).

`TRAILER_MODE` no `.env` **não altera** o algoritmo (valores `minuto*` antigos são ignorados).

Modos legado só por argumento explícito: `trailer.bat minuto15`, `trailer.bat sparse`, etc.

Ajuste fino no `.env`: **`TRAILER_PCT_SEG`**, **`TRAILER_PCT_STEP`**, **`TRAILER_LONG_MIN_SEC`**, **`TRAILER_LONG_STEP_SEC`** (padrão 15 / 5 / 3600 / 300).

**`preview.bat`** (job «Trailer + preview» no Admin) já **não** gera `preview/*.mp4` — só aquece **miniaturas JPEG** em `.thumb_cache/` a partir dos trailers. O palco toca sempre o **trailer**; ficheiros antigos em `preview/` ficam legados e não são usados para reprodução. Para libertar espaço: `npm run clear-preview-videos` (lista) ou `npm run clear-preview-videos -- --delete` (envia vídeos em `preview/` para a lixeira; **`.thumb_cache/` intacto**).

## Admin (`/admin`)

Com **`VIDEO_ADMIN_TOKEN`** definido no servidor, guarda o token na página Admin e usa:

- edição do **menu de pastas** (grava `data/video-menu.json`);
- **Trailer + miniaturas** por pasta (um botão na tabela) ou, nas acções gerais, **Trailers (todas)**, **Previews (todas)** ou **Trailer + preview (todas)** — «preview» corre `preview.bat`, que gera só JPEG em `.thumb_cache/` (não vídeo curto em `preview/`);
- contagens / cruzamento **trailers ↔ preview**;
- **auto-tags** e outras ferramentas de manutenção.

## Ficheiros locais em `data/` (geralmente ignorados pelo Git)

- `video-menu.json` — menu de bibliotecas (se existir)
- `library-state.json` — favoritos e progresso do vídeo completo
- `library-tags.sqlite` — tags por sessão / trailer
- `sync-last-failures.json`, `bat-work/`, logs de sync — jobs dos `.bat`

Não commitar `.env` nem estes dados sensíveis à máquina; usar `.env.example` e `data/*.example` como modelo.

## Licença

Projeto **privado** (`"private": true` no `package.json`). Ajuste a licença se for distribuir o código.
