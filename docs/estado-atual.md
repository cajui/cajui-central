# Estado atual — Cajuí software

Atualizado em 2026-09-22. Bootstrap implementado; independente do hardware.

## Entrega

Go 1.27, SQLite modernc v1.59.0 com dependências fixadas/go.sum, API HTTP v1,
interface HTML incorporada, migração transacional de schema, validação e ingestão
idempotente. Token para API, servidor restrito a loopback, limites de payload e
timeouts, encerramento com contexto/sinais. Licença Apache-2.0.
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

Ambiente de validação: macOS arm64, Go 1.27.1 oficial, sem instalação
global.

## Limites

Não há ponte serial/MQTT, recebimento físico, cadastro, detecção de disponibilidade,
automações, login multiusuário, retenção, backup operacional ou instalador.
Interface read-only local não deve ser exposta por túnel/proxy. Não confundir recebimento de exemplo simulado com medição real. Contrato não assume sensor específico.

## Próximo passo

Definir contrato MQTT/status dos dispositivos e implementar adaptador de ingestão
reutilizando telemetry/storage, com testes de reconexão, mensagens repetidas e
falhas. Depois validar uma amostra real de um dispositivo no histórico e na interface.
Antes de publicação: URL real do módulo, canal privado de segurança e repositório remoto.
