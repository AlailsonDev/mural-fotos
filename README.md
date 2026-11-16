# Mural de Fotos — envio por QR Code e transmissão no telão

**ESCANEAR → ESCOLHER FOTO → ENVIAR → APARECER NO TELÃO.**

Aplicação completa para eventos: os participantes escaneiam um **QR Code permanente**, enviam fotos pelo navegador do celular (sem instalar nada) e as fotos aparecem automaticamente, uma por vez, no computador ligado ao projetor.

- Sem banco de dados e sem serviços pagos: tudo fica em **arquivos no próprio computador** (`/data`).
- Servidor Node.js persistente (Next.js + Socket.IO) que roda no **Windows 10/11**.
- Três interfaces: **página de envio** (`/`), **tela de transmissão** (`/transmissao`) e **painel administrativo** (`/admin`).

---

## Sumário

1. [Instalação rápida (Windows)](#1-instalação-rápida-windows)
2. [Uso no dia do evento](#2-uso-no-dia-do-evento)
3. [Cenário A — Wi-Fi local](#3-cenário-a--evento-com-wi-fi-local)
4. [Cenário B — internet móvel (domínio + Cloudflare Tunnel)](#4-cenário-b--participantes-usando-internet-móvel)
5. [Projetor, tela cheia e modo quiosque](#5-projetor-tela-cheia-e-modo-quiosque)
6. [Inicialização automática com o Windows](#6-inicialização-automática-com-o-windows)
7. [Funcionamento da fila e da transmissão](#7-funcionamento-da-fila-e-da-transmissão)
8. [Armazenamento e backup](#8-armazenamento-e-backup)
9. [Segurança](#9-segurança)
10. [Configuração (.env)](#10-configuração-env)
11. [Desenvolvimento e testes](#11-desenvolvimento-e-testes)
12. [Solução de problemas](#12-solução-de-problemas)

---

## 1. Instalação rápida (Windows)

### 1.1 Instalar o Node.js
1. Acesse <https://nodejs.org/pt-br/download> e baixe a versão **LTS** (20 ou superior).
2. Instale com as opções padrão (Avançar → Avançar → Concluir).
3. Para conferir, abra o **Prompt de Comando** e digite `node -v`. Deve aparecer algo como `v22.x.x`.

### 1.2 Instalar o Mural de Fotos
1. Copie a pasta `mural-fotos` para o computador (ex.: `C:\MuralDeFotos`). Evite pastas sincronizadas (OneDrive).
2. Dê dois cliques em **`install.bat`**. Ele vai:
   - verificar o Node.js;
   - instalar as dependências (precisa de internet nesta etapa);
   - criar as pastas de dados;
   - perguntar a **porta**, o **endereço público** (opcional) e a **senha administrativa**;
   - compilar a interface.
3. Dê dois cliques em **`liberar-firewall.bat`** com o botão direito → **Executar como administrador** (libera a porta para os celulares da rede).

> **Senha administrativa:** ela é pedida pelo instalador e salva **somente como hash** (scrypt) no arquivo `.env`. Para trocá-la depois, abra o Prompt de Comando na pasta do projeto e execute `npm run set-password`, depois reinicie o servidor.

### 1.3 Iniciar
Dê dois cliques em **`start.bat`**. Ele verifica dependências, pastas e configurações, inicia o servidor e mostra:

```
  Neste computador:        http://localhost:3000
  Na rede local (Wi-Fi):   http://192.168.0.15:3000
  Transmissão (projetor):  http://localhost:3000/transmissao
  Painel administrativo:   http://localhost:3000/admin
  Endereço público:        não configurado (modo local)
  QR Code aponta para:     http://192.168.0.15:3000/  [modo local]
  PRONTO para receber fotografias no evento "..."
```

Se o servidor cair por qualquer motivo, o `start.bat` o reinicia sozinho em 5 segundos. Para encerrar, feche a janela.

---

## 2. Uso no dia do evento

1. Execute `start.bat`.
2. Abra `http://localhost:3000/admin`, entre com a senha.
3. **Eventos → Novo evento** → informe o nome (ex.: “Confraternização 2026”) e marque *Iniciar o evento agora*.
4. **QR Code** → baixe PNG/SVG ou use **Versão para impressão** (1 ou 4 cartões por folha A4). *Imprima uma vez: o mesmo QR Code serve para todos os eventos.*
5. No computador do projetor, clique em **Abrir tela de transmissão** e pressione **F** para tela cheia.
6. Pronto. As fotos entram na fila e são exibidas automaticamente.

Durante o evento, pelo painel você pode: pausar/retomar/parar a transmissão, pular a foto atual, exibir a próxima, mudar o tempo de exibição (5/8/10/15/20 s ou personalizado), rejeitar, excluir, recolocar na fila ou mandar uma foto para “exibir em seguida”, e pausar os envios (os celulares veem “Envios pausados” na hora).

Ao final: **Encerrar** (bloqueia novos envios e guarda as fotos no histórico) ou **ENCERRAR E LIMPAR EVENTO** (encerra e apaga as fotos, mediante confirmação digitando `LIMPAR`).

---

## 3. Cenário A — evento com Wi-Fi local

O computador e os celulares estão na **mesma rede Wi-Fi**. Não depende de internet nem de nenhum serviço externo.

1. Conecte o computador ao Wi-Fi do evento (ou ao roteador por cabo).
2. No Windows, marque essa rede como **Privada**: *Configurações → Rede e Internet → Wi-Fi → (rede) → Tipo de perfil de rede: Privada*.
3. Execute `liberar-firewall.bat` como administrador (uma única vez).
4. O IP local aparece no `start.bat` e no painel (**QR Code** / **Configurações → Rede**). Para conferir manualmente: Prompt de Comando → `ipconfig` → “Endereço IPv4” do adaptador Wi-Fi/Ethernet.
5. Teste com um celular conectado ao mesmo Wi-Fi: abra `http://IP-DO-COMPUTADOR:3000`.

> **Importante sobre o QR Code no modo local:** ele contém o IP do computador. Se o IP mudar (outro roteador/outro local), o QR Code muda. Para mantê-lo fixo, **reserve o IP** no roteador (DHCP reservation / “IP fixo” pelo endereço MAC do computador) ou use o Cenário B. Se o computador tiver vários adaptadores, escolha o correto em **Configurações → Endereço IP local preferido**.
>
> Redes de convidados com “isolamento de clientes” (comum em hotéis/buffets) impedem que celulares acessem o computador. Use um roteador próprio ou o Cenário B.

**Firewall manualmente (alternativa ao .bat):** *Painel de Controle → Windows Defender Firewall → Configurações avançadas → Regras de Entrada → Nova Regra → Porta → TCP 3000 → Permitir → marcar apenas “Particular” → nome “Mural de Fotos”.*

---

## 4. Cenário B — participantes usando internet móvel

Os participantes usam 4G/5G e acessam um **domínio público permanente**, que é encaminhado com segurança até o computador do evento por um **túnel** (Cloudflare Tunnel). O QR Code aponta sempre para o mesmo domínio.

**O que é necessário (dependências reais):**
- Um **domínio próprio** (ex.: comprado em qualquer registrador) com o DNS gerenciado pela Cloudflare (plano gratuito atende).
- Conta gratuita na Cloudflare.
- O computador do evento **conectado à internet** durante todo o evento.
- O programa `cloudflared` instalado no computador.

> Não use “Quick Tunnels” (`trycloudflare.com`) para o QR Code: o endereço muda a cada execução e o QR Code impresso deixaria de funcionar. Este sistema **não** funciona remotamente sem internet ou sem domínio + túnel configurados.

### 4.1 Passo a passo
1. **Adicione o domínio à Cloudflare** (*Add a site*) e troque os *nameservers* no seu registrador pelos indicados pela Cloudflare. Aguarde a ativação.
2. **Instale o cloudflared** no Windows: baixe o instalador `.msi` em <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/> (ou `winget install --id Cloudflare.cloudflared`).
3. **Crie o túnel pelo painel** (recomendado): *Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*. Dê um nome (ex.: `mural-fotos`). O painel mostra um comando `cloudflared service install <TOKEN>` — **execute-o no Prompt de Comando como administrador**. Isso instala o túnel como serviço do Windows (inicia sozinho com o computador).
   - O token é uma credencial: **não** o coloque no código, no `.env` nem em repositórios.
4. **Public Hostname** (na mesma tela do túnel): *Add a public hostname* →
   - Subdomain: `fotos` · Domain: `seudominio.com.br`
   - Service: `HTTP` · URL: `localhost:3000`
   A Cloudflare cria o registro DNS automaticamente e fornece **HTTPS** com certificado válido.
5. **Configure o endereço público no Mural**: rode `npm run setup` (ou edite o `.env`):
   ```
   PUBLIC_BASE_URL=https://fotos.seudominio.com.br
   TRUST_PROXY=1
   ```
   Também é possível informar o endereço em **Painel → Configurações → Endereço público**, sem editar arquivos. `TRUST_PROXY=1` faz o limite de envios usar o IP real de cada visitante.
6. Reinicie (`start.bat`). O banner mostra `QR Code aponta para: https://fotos.seudominio.com.br/ [modo remoto]`.
7. Teste com o Wi-Fi do celular **desligado** (usando 4G): abra o domínio, envie uma foto.

**Alternativa por linha de comando** (sem painel): `cloudflared tunnel login`, `cloudflared tunnel create mural-fotos`, `cloudflared tunnel route dns mural-fotos fotos.seudominio.com.br` e um `config.yml` com `ingress: - hostname: fotos.seudominio.com.br service: http://localhost:3000` seguido de `- service: http_status:404`. Depois `cloudflared service install`.

O mesmo computador continua aceitando conexões pela rede local ao mesmo tempo. A tela de transmissão deve ser aberta por `http://localhost:3000/transmissao` (não depende da internet).

---

## 5. Projetor, tela cheia e modo quiosque

**Conectar o projetor:** ligue o cabo HDMI, pressione **Windows + P** e escolha **Duplicar** (mesma imagem) ou **Estender** (projetor como segunda tela — arraste a janela da transmissão para ela). Em *Configurações → Sistema → Tela*, ajuste a resolução recomendada do projetor. Desative a suspensão de tela: *Configurações → Sistema → Energia → Tela: Nunca*.

**Tela cheia:** na tela de transmissão pressione **F** (ou dê duplo clique, ou use o botão que aparece ao mover o mouse). **I** mostra/oculta os indicadores (fila, conexão, pausa). O cursor some sozinho.

**Chrome em modo quiosque** (abre direto em tela cheia, sem barras):
1. Clique com o botão direito na área de trabalho → *Novo → Atalho*.
2. Local do item:
   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=http://localhost:3000/transmissao --autoplay-policy=no-user-gesture-required --disable-session-crashed-bubble --noerrdialogs
   ```
3. Nome: “Transmissão Mural”. Para sair do quiosque: **Alt + F4**.

**Autorização da tela:** a tela de transmissão mostra fotos de todos os participantes, por isso ela só funciona em um navegador **logado no painel** ou autorizado pela **chave de transmissão**. No modo quiosque, use o link com a chave que aparece em **Painel → Transmissão → Tela em outro computador** (`.../transmissao?chave=...`). A autorização fica salva por 30 dias naquele navegador.

---

## 6. Inicialização automática com o Windows

1. Pressione **Windows + R**, digite `shell:startup` e Enter. Abre a pasta *Inicializar*.
2. Crie ali um atalho para o **`start.bat`** (botão direito no `start.bat` → *Criar atalho* → mova o atalho para a pasta). Opcional: nas propriedades do atalho, *Executar: Minimizada*.
3. Crie também na mesma pasta o atalho do **Chrome em modo quiosque** (seção 5). Como o servidor leva alguns segundos para subir, a tela tenta reconectar sozinha até ele ficar disponível.
4. Para login automático do Windows (opcional, em computador dedicado): `netplwiz` → desmarque “Os usuários devem digitar um nome de usuário e senha”.

Alternativa mais robusta: *Agendador de Tarefas → Criar Tarefa → Disparadores: Ao fazer logon → Ações: Iniciar programa → `C:\MuralDeFotos\start.bat` → Iniciar em: `C:\MuralDeFotos`*.

---

## 7. Funcionamento da fila e da transmissão

- **O servidor é a autoridade.** Uma máquina de estados no servidor decide qual foto está no telão e qual é a próxima; as telas apenas exibem. Abrir duas abas de transmissão não gera reproduções paralelas — ambas mostram a mesma foto.
- **Ordem de chegada pelo servidor.** Cada foto recebe uma posição dentro de um mutex: envios simultâneos nunca recebem posições repetidas.
- **Uma por vez.** Uma foto nova nunca interrompe a atual; ela entra no fim da fila. A próxima foto é pré-carregada na tela para a troca ser instantânea.
- **Tempo de exibição** (padrão 8 s) e **transição** (padrão 1,2 s) configuráveis; valem a partir da foto seguinte.
- **Fila vazia** → tela de espera com nome do evento, mensagem, QR Code e indicador de conexão. Chegou foto → começa sozinha.
- **Sem tela conectada** → o relógio congela (a foto não é dada como exibida sem ninguém ver). Ao reconectar, continua de onde parou.
- **Queda de rede/atualização da página** → a tela reconecta sozinha e busca o estado atual; nada é duplicado.
- **Reinício do servidor/computador** → regra consistente: a foto que estava em exibição volta para a fila **com a mesma posição** (será a primeira a aparecer); as demais permanecem intactas. O estado da transmissão (rodando/pausada/parada) também é restaurado.
- **Reenvio após falha no celular** → cada foto leva um identificador gerado no celular; se o envio for repetido, o servidor reconhece e não duplica.

Estados das fotos: `queued` (aguardando), `playing` (no telão), `displayed` (exibida), `rejected` (rejeitada). Fotos exibidas nunca voltam sozinhas para a fila (somente por “Recolocar na fila”).

Eventos Socket.IO emitidos: `photo:uploaded`, `photo:queued`, `photo:playing`, `photo:displayed`, `photo:rejected`, `queue:updated`, `event:started`, `event:paused`, `event:finished`, `transmission:started`, `transmission:paused`, `transmission:resumed`, `transmission:next`, `system:status`.

---

## 8. Armazenamento e backup

```
data/
├── events/
│   └── <ID-DO-EVENTO>/
│       ├── uploads/     fotos otimizadas aguardando/na fila
│       ├── displayed/   fotos já exibidas
│       ├── rejected/    fotos rejeitadas
│       ├── thumbs/      miniaturas para o painel
│       ├── originals/   originais (só se "Guardar original" estiver ativo)
│       ├── event.json   dados do evento (+ event.json.bak)
│       └── photos.json  fila e metadados das fotos (+ photos.json.bak)
├── config/
│   ├── settings.json    configurações (+ .bak)
│   └── logo.png         logotipo (se enviado)
├── logs/
│   ├── app.log
│   └── cleanup.log      registro de limpezas
└── tmp/                 uploads em andamento (limpo ao iniciar)
```

- Cada foto é salva com nome **UUID** — um envio nunca sobrescreve outro. As fotos continuam no disco depois de exibidas; mudar o status apenas move o arquivo entre pastas (o conteúdo nunca é alterado; se o Windows bloquear a movimentação, o arquivo fica onde está e os metadados apontam para o local real).
- Os JSON são gravados de forma **atômica** (arquivo temporário + `fsync` + renomear), com cópia `.bak` da versão anterior. Se um arquivo estiver corrompido, o sistema restaura do `.bak` automaticamente.
- Todas as gravações passam por uma fila (mutex): envios simultâneos não sobrescrevem metadados.
- Fotos só são apagadas por ação administrativa explícita ou pela **limpeza automática** (padrão: 48 h após o encerramento do evento; configurável; nunca afeta evento ativo/pausado). O histórico e as estatísticas permanecem.
- **Backup:** feche o servidor e copie a pasta `data` inteira.

Processamento (Sharp): verificação da assinatura real do arquivo (não confia na extensão), decodificação completa (arquivos corrompidos são recusados), correção da orientação EXIF, remoção de metadados (EXIF/GPS), redimensionamento sem ampliar (padrão 2560 px) e conversão para WebP (ou JPEG). Os arquivos são lidos em fluxo, sem carregar a imagem inteira na memória do Node; no máximo 2 imagens são processadas ao mesmo tempo e até 30 envios simultâneos são aceitos (os demais recebem “tente em alguns segundos”, com nova tentativa automática no celular).

Formatos aceitos: JPG/JPEG, PNG, WebP. No iPhone, ao escolher fotos da galeria o Safari converte HEIC para JPEG automaticamente.

---

## 9. Segurança

- Painel protegido por senha (hash **scrypt**, nunca em texto puro), sessão assinada (HMAC) em cookie **HttpOnly**, `SameSite=Lax` e `Secure` quando acessado por HTTPS; expira em 12 h. “Encerrar todas as sessões” invalida todos os cookies.
- **CSRF:** toda operação administrativa de escrita exige token sincronizado (`X-CSRF-Token`) e confere a origem da requisição.
- **Rate limiting:** login (10 tentativas/15 min por IP), envios (configurável, padrão 30 por 10 min por IP), API geral (600/min por IP).
- Validação de tamanho e de conteúdo das imagens no navegador **e** no servidor; nomes de arquivos do usuário nunca são usados no disco; IDs validados como UUID (sem *path traversal*); caminhos físicos nunca são expostos.
- A pasta `data` não é servida publicamente; arquivos JSON de configuração não são acessíveis pela web.
- Rotas separadas: públicas (`/api/public/*`, QR Code), tela de transmissão (chave/cookie próprio) e administrativas (`/api/admin/*`). Participantes não veem fotos de outras pessoas, não excluem fotos e não alteram a fila.
- Socket.IO com validação de origem e três canais isolados (público, tela, admin) com autenticação por cookie.

---

## 10. Configuração (.env)

Gerado pelo `install.bat` / `npm run setup`. Modelo em `.env.example`.

| Variável | Descrição |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `HOST` | `0.0.0.0` para aceitar celulares da rede |
| `PUBLIC_BASE_URL` | Endereço público permanente (modo remoto). Vazio = modo local |
| `ADMIN_PASSWORD_HASH` | Hash da senha (gere com `npm run set-password`) |
| `SESSION_SECRET` | Segredo das sessões (gerado automaticamente) |
| `DATA_DIR` | Pasta de dados (padrão `./data`) |
| `TRUST_PROXY` | `1` quando atrás do Cloudflare Tunnel/proxy |
| `ALLOWED_ORIGINS` | Origens extras permitidas (separadas por vírgula) |

As demais opções (limites, tempos, qualidade, cores, logotipo, mensagens, limpeza, modo do QR Code, IP preferido) ficam no painel e são salvas em `data/config/settings.json`.

---

## 11. Desenvolvimento e testes

```bash
npm install
npm run setup        # cria o .env
npm run dev          # modo desenvolvimento (recarrega ao editar)
npm run build && npm start   # modo produção
npm test             # testes automatizados (Vitest)
npm run typecheck
```

Estrutura:
```
server/            servidor Node customizado (Next.js + Express + Socket.IO)
  start.ts         ponto de entrada
  index.ts         montagem do servidor e banner de inicialização
  realtime.ts      canais Socket.IO
  http/            rotas, upload (busboy + Sharp), segurança
  store/           events.ts (JSON + mutex), playback.ts (máquina de estados), settings.ts
  lib/             gravação atômica, auth, imagens, rate limit, rede, logs
app/               páginas (/, /transmissao, /admin, /admin/qr)
components/        interfaces React
tests/             testes do armazenamento, fila, transmissão e API
```

Os testes automatizados cobrem: envio de 1 e de 3 fotos, limite por envio, vários celulares simultâneos (posições únicas e nenhum arquivo sobrescrito), ordem da fila, reprodução sequencial, foto nova não interrompe a atual, fila vazia, recuperação após reinício (no store e no meio da reprodução), queda e retorno da conexão sem duplicar, pausa/retomada/pular/próxima/parar, rejeitar/recolocar/excluir, QR Code idêntico entre eventos, bloqueio de não autenticados, CSRF e origem, arquivos inválidos/corrompidos, tamanho máximo, rate limiting, remoção de EXIF, isolamento entre eventos, gravação atômica com recuperação do backup e limpeza que nunca apaga evento ativo.

---

## 12. Solução de problemas

| Problema | Solução |
|---|---|
| Celular não abre a página | Mesmo Wi-Fi? Rede marcada como Privada? `liberar-firewall.bat` executado? Rede sem isolamento de clientes? Teste `http://IP:3000` no celular. |
| “A porta 3000 já está em uso” | Feche outra janela do servidor ou altere `PORT` no `.env` (e rode o `liberar-firewall.bat` de novo). |
| Fotos não aparecem no telão | O painel mostra “Nenhuma tela conectada”? Abra `/transmissao`. A transmissão está pausada/parada? Há evento ativo? |
| Tela pede “chave de transmissão” | Abra pelo painel (mesmo navegador logado) ou use o link com a chave em *Painel → Transmissão*. |
| QR Code aponta para IP errado | *Configurações → Endereço IP local preferido*, ou configure endereço público. |
| Não consigo entrar no painel | `npm run set-password` e reinicie. Após 10 tentativas erradas, aguarde 15 min. |
| Computador simples ficando lento | Desative “Fundo desfocado” e use resolução máxima 1920 px. |
