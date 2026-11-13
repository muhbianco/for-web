# @muchat/space-client

O mapa do Muchat Espaço no navegador, sem depender de framework: o app (Solid) só monta o
`SpaceView` e desenha o `SpaceUiState`. Regras compartilhadas no
[`@muchat/space-core`](../space-core/README.md); servidor no
[`@muchat/space-server`](../space-server/README.md).

## Peças

| Arquivo | Papel |
|---|---|
| `connection.ts` | WebSocket `/_muchat/space/v1/ws`. A sessão vai no `hello`, nunca na URL. Reconexão com espera crescente e variação aleatória; para de vez em 4401, 4403 e 4001 (outra aba assumiu) |
| `world.ts` | Cópia do mundo. Os outros aparecem interpolados 100 ms atrás, sem extrapolar. A correção do servidor sempre vence |
| `mover.ts` | Movimento previsto com a mesma colisão e regra de porta do servidor (`slide`, `findPath`). Envia no máximo 15 Hz, e a parada sai na hora. Velocidade a 95% do limite |
| `media.ts` | `MediaLink`: segue os eventos de mídia do servidor e a voz do app. `media.grant` → conecta; `media.revoked` → sai da chamada (só se for a do espaço); falha → pede token novo após 3, 6 e 12 s, depois botão. Nunca tira a voz de outra chamada (DM, grupo) sozinho: só ao entrar andando na sala ou num botão |
| `list.ts` | Modelo em texto para a lista acessível e para o `aria-live`: alas, salas, ocupação ao vivo, "Entrada" / "Corredor · Ala X" / nome da sala. Sala e ala privadas aparecem como "Sala privada" e "Ala restrita" |
| `render/` | PixiJS 8.22, carregado só nesta view. O chão vai em blocos de 32×32 tiles, e só os blocos perto da câmera existem na GPU. Portas e nomes ficam numa camada à parte. Personagens pixel-art 16×16 desenhados em código (provisórios, até a arte definitiva), 4 direções e passo de caminhada. Zoom inteiro de 1× a 3×. Câmera sem suavização com `prefers-reduced-motion` |
| `view.ts` | Liga tudo: teclado (setas/WASD, Esc, + e −), clique ou toque para andar, `presence.idle` quando a aba some, `walkToRoom`, estado para a interface a 4 Hz |

## Página de desenvolvimento

Roda contra o servidor do espaço em modo dev: o gateway real com um Stoat simulado
(`space-server/src/dev.ts`), com Ana, Bia (diretoria) e Caio, mais dois personagens automáticos.

```bash
node packages/space-server/src/dev.ts            # :8095
pnpm --filter @muchat/space-client dev           # http://localhost:5180/?as=ana
```

O proxy do Vite repete o Caddy (`/_muchat/space/*` → servidor, prefixo cortado). A página expõe
`window.__space` para automação. Ela nunca vai para produção.

## Verificado no navegador (13/11/2026)

- Conecta, mostra o lobby e a lista com a ocupação ao vivo.
- O clique anda pelo caminho; a câmera segue; entra no Bate-papo com "Você entrou em Bate-papo."
  no `aria-live`.
- Bia (diretoria) andou do lobby até a sala privada com **0 correções** do servidor.
- Na aba da Ana, a Bia estava visível no corredor e **sumiu** ao entrar na sala privada.
- A Ana vê "🔒 Sala privada" na lista, a porta trancada com cadeado no mapa, e o caminho para
  dentro é recusado.

## Testes

```bash
pnpm --filter @muchat/space-client test
pnpm --filter @muchat/space-client typecheck
```

`world.test.ts` cobre decodificação do mapa, interpolação, cadência de envio e correção. O caso
central reaplica no validador do servidor os movimentos gerados pelo cliente com a mesma cadência,
e todos são aceitos.

## No app do Muchat (2d)

Fica em `packages/client/components/space/`. No código vindo do upstream entram só uma linha de
rota em `src/index.tsx` e uma linha na `ServerSidebar`.

- **`config.ts`:** `GET /_muchat/space/v1/config`, uma vez por sessão. Diz em quais servidores o
  espaço está ligado.
  - **Qualquer falha significa "nenhum"**: serviço ainda não implantado, sem rede, outra instância.
    Nesse caso a barra lateral fica exatamente como antes.
  - Também traz `sessionToken` (só de pessoa, nunca de bot) e `clientKind`.
- **`SpaceSidebarEntry.tsx`:** item "Espaço" no topo da lista de canais, só nos servidores
  ligados.
- **`SpacePage.tsx`:** rota `/server/:server/space`, carregada sob demanda com `lazy()`, então o
  PixiJS não entra no pacote principal.
  - Barra com o lugar, o estado da conexão, "Usar aqui" quando outra aba assumiu, zoom e botão da
    lista.
  - Mapa e lista de salas lado a lado; empilhados em tela estreita.
  - Região `aria-live`.
- **`Onboarding.tsx`:** primeiro acesso, com o que mudou, a escolha entre 8 personagens e como
  andar.
  - Pular mantém o personagem padrão e conta como feito.
  - O progresso fica no servidor (`/v1/me/profile`), então não se repete em outro aparelho.
  - O passo do áudio entra com a voz (fase 3).
- **Textos** no Lingui, com o português como id, como no resto do fork; `lingui extract` já rodou.

## Voz nas salas (3b)

A sala **é** o canal de voz do Stoat. Então o `Voice` do app conecta nela com o token do espaço
em vez do `join_call`, e tudo o que já existe continua igual: dock, cartão flutuante, microfone,
câmera, tela, supressão de ruído, dispositivos e serviço de voz do Android.

- **`session.ts`:**
  - Adapta o `Voice` ao `VoicePort` do `MediaLink`.
  - Mantém o espaço conectado **fora da página** enquanto a pessoa está numa sala com áudio. Dá
    para ler o chat da sala, ou qualquer canal, sem cair da voz.
  - Na volta à página, o mesmo mapa é religado.
  - Sem áudio a manter (saiu da sala, desligou no dock), o espaço fecha sozinho.
- **Barra do mapa:** estado do áudio, com os botões que cabem em cada caso:
  - "Conectando áudio…";
  - "Áudio da sala conectado";
  - "Áudio indisponível", com "Tentar de novo";
  - "Seu áudio está em outra aba ou outro servidor", com "Usar aqui";
  - "Você está fora do áudio da sala", com "Voltar ao áudio".
- **Identity `sp_<usuário>_<n>`** (uma por entrada): `components/rtc/identity.ts` devolve o
  usuário para o cartão da chamada, o volume e o mudo por pessoa, e os ícones.
- **Sala cheia:** a porta não abre na previsão do cliente, como no servidor (`voice.max_users`),
  e a lista mostra "cheia".
- **Primeiro acesso:** ganhou o passo do áudio (`AudioCheck.tsx`).
  - Escolha de dispositivos (os mesmos ajustes de Configurações → Voz).
  - "Testar microfone" com medidor.
  - Mensagens para permissão negada e para quem não tem microfone.
  - O passo vale **por aparelho**: num aparelho novo aparece sozinho, uma vez.

Verificado em 13/11/2026 na página de dev, com o servidor real, LiveKit simulado e uma voz
simulada no navegador:

- Entrar no Café foi de `connecting` a `connected`, com a identity `sp_<ana>_…`. Sair voltou a
  `idle` e desligou a chamada. Nenhuma correção do servidor.
- Com a conexão falhando (`?voicefail=1`), a pessoa ficou na sala e as tentativas automáticas
  saíram após 3 e 6 s.
- Com "Duo" (2 lugares) ocupada, a porta não abriu na previsão e a lista mostrou "2 pessoas ·
  cheia".

O personagem escolhido vai para o servidor (`PUT /v1/me/profile`) e chega aos outros na próxima
difusão; verificado entre duas abas.

## Ainda não

- **Voz com LiveKit de verdade:** ainda não testada. O caminho completo (gate, enforcer, voice-ingress)
  é a 3c e a 3d, no laboratório.
- Portas com tranca e batida (fase 4).
- **Teste de saída de áudio** no primeiro acesso (tocar um som no alto-falante escolhido).
- **Lista acessível:** ainda só leitura. "Ir para" e "Bater" chegam com as portas.
- **Sem WebGL:** a tela mostra um aviso; o modo só lista (sem mapa) ainda não existe.
- Arte definitiva no lugar dos personagens provisórios.
- **Medição:** FPS no app do PC e em Android médio.
- **Tela integrada de verdade:** ainda não foi vista com login real (o navegador de teste não tem
  sessão). Foram verificados o build, os tipos e a página de dev com o mesmo `SpaceView`.
