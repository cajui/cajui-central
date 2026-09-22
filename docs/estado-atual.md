# Estado atual — Cajuí software

Atualizado em 2026-09-22. Bootstrap implementado; independente do hardware.
Execução por Docker adicionada no mesmo dia; Go local deixou de ser requisito.

## Entrega

Go 1.27, SQLite modernc v1.59.0 com dependências fixadas/go.sum, API HTTP v1,
interface HTML incorporada, migração transacional de schema, validação e ingestão
idempotente. Token para API, servidor restrito a loopback, limites de payload e
timeouts, encerramento com contexto/sinais. Licença Apache-2.0 escolhida pelo proprietário.
Git independente em software/cajui, remoto público em
https://github.com/romulostorel/cajui-central; nome público **Cajuí Central**
(decisão do proprietário, 2026-09-22). Módulo Go com o endereço real.

Docker: `Dockerfile` em dois estágios (build em `golang:1.27`, execução em
`distroless/static` não root, binário estático sem cgo), `compose.yaml` com volume
nomeado `cajui-data`, porta publicada só em `127.0.0.1` do host e token obrigatório
via `.env` (`.env.example` incluído). `make docker-check` roda as verificações em
contêiner; `make docker-build` gera `cajui:local`. Config ganhou o opt-in
`CAJUI_ALLOW_NON_LOOPBACK=1`, exigido dentro do contêiner e testado. CI ganhou job
que constrói a imagem; Dependabot acompanha imagens base.

## Verificado

- `make check`: formatação, go vet, testes com race; cobertura total **89,2%**.
- Configuração e validação: 100%; API: 97,7%; armazenamento: 85,3%; comando: 65,6%.
- SQLite real: persistência após reabertura, duplicatas concorrentes, conflitos,
  sessão após reinício, timestamp medido, banco inválido e schema futuro rejeitado.
- HTTP: autenticação, entrada inválida, zero válido, limite de payload, erros sem
  detalhes internos, interface vazia/preenchida e servidor TCP com shutdown.
- `make build` passou e gerou bin/cajui; `go mod verify` confirmou dependências.
- Docker (2026-09-22, Docker Desktop 27.4.0/Compose 2.31 em macOS arm64): `make
  docker-check` passou dentro de `golang:1.27` com o mesmo resultado acima; imagem
  final de 24,2 MB rodando como uid 65532; `docker compose up --build` respondeu
  GET / 200, POST sem token 401, POST simulado 201 e exibiu o valor; após
  `docker compose down` e `up` a medição persistiu no volume; Compose recusa subir
  sem CAJUI_API_TOKEN. Teste feito em projeto Compose separado, depois removido.
- CI GitHub preparada com limiar de cobertura de 80%, build, artefato de cobertura
  e construção da imagem; ainda não executada remotamente. Dependabot configurado.

Ambiente de validação original: macOS arm64, Go 1.27.1 baixado de go.dev para
/tmp/cajui-toolchain/go, SHA256 verificado contra catálogo oficial. Não houve
instalação global do Go. Teste TCP precisou sair do sandbox para abrir porta local.
Caches temporários em /tmp/cajui-go-cache e /tmp/cajui-gopath (somem no reboot).

## Limites

Não há ponte serial/MQTT, recebimento físico, cadastro, detecção de disponibilidade,
automações, login multiusuário, retenção, backup operacional ou instalador.
Interface read-only local não deve ser exposta por túnel/proxy nem publicada em
0.0.0.0. Não confundir recebimento de exemplo simulado com validação do rádio.
Nenhum firmware/CAD alterado. Windows e SO dedicado ficam para o futuro. Contrato
não assume sensor específico. Imagem sem healthcheck; backup do volume ainda manual
e só com o serviço parado (WAL).

## Próximo passo

Definir contrato MQTT/status da central e implementar adaptador de ingestão
reutilizando telemetry/storage, com testes de reconexão, mensagens repetidas e
falhas. Depois validar uma amostra física da receptora no histórico e na interface.
Publicação: módulo e remoto definidos; falta habilitar o canal privado de segurança no
GitHub e confirmar a primeira execução da CI remota.
