# Estado atual — Cajuí software

Atualizado em 2026-09-22. Bootstrap implementado; independente do hardware.

## Entrega

Go 1.27, SQLite modernc v1.59.0 com dependências fixadas/go.sum, API HTTP v1,
interface HTML incorporada, migração transacional de schema, validação e ingestão
idempotente. Token para API, servidor restrito a loopback, limites de payload e
timeouts, encerramento com contexto/sinais. Licença Apache-2.0 escolhida pelo proprietário.
Git local independente em software/cajui; ainda sem remoto/publicação.

## Verificado

- `make check`: formatação, go vet, testes com race; cobertura total **89,2%**.
- Configuração e validação: 100%; API: 97,7%; armazenamento: 85,3%; comando: 65,6%.
- SQLite real: persistência após reabertura, duplicatas concorrentes, conflitos,
  sessão após reinício, timestamp medido, banco inválido e schema futuro rejeitado.
- HTTP: autenticação, entrada inválida, zero válido, limite de payload, erros sem
  detalhes internos, interface vazia/preenchida e servidor TCP com shutdown.
- `make build` passou e gerou bin/cajui; `go mod verify` confirmou dependências.
- CI GitHub preparada com limiar de cobertura de 80%, build e artefato de cobertura;
  ainda não executada remotamente. Dependabot configurado.

Ambiente de validação: macOS arm64, Go 1.27.1 baixado de go.dev para
/tmp/cajui-toolchain/go, SHA256 verificado contra catálogo oficial. Não houve
instalação global do Go. Teste TCP precisou sair do sandbox para abrir porta local.
Caches temporários em /tmp/cajui-go-cache e /tmp/cajui-gopath.

## Limites

Não há ponte serial/MQTT, recebimento físico, cadastro, detecção de disponibilidade,
automações, login multiusuário, retenção, backup operacional ou instalador.
Interface read-only local não deve ser exposta por túnel/proxy. Não confundir
recebimento de exemplo simulado com validação do rádio. Nenhum firmware/CAD alterado.
Windows e SO dedicado ficam para o futuro. Contrato não assume sensor específico.

## Próximo passo

Definir contrato MQTT/status da central e implementar adaptador de ingestão
reutilizando telemetry/storage, com testes de reconexão, mensagens repetidas e
falhas. Depois validar uma amostra física da receptora no histórico e na interface.
Antes de publicação: URL real do módulo, canal privado de segurança e repositório remoto.
