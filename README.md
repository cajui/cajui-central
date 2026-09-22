# Cajuí

Plataforma local de monitoramento, independente das placas e do firmware.
Bootstrap em desenvolvimento; ainda não controla atuadores nem recebe LoRa/MQTT.

## Executar

Requisitos: Go 1.27+, Make; toolchain C para `go test -race`.

```sh
export CAJUI_API_TOKEN="$(openssl rand -hex 32)"
make run
```

Abra http://127.0.0.1:8080. Banco criado em `data/cajui.db`.
Variáveis: CAJUI_ADDR (padrão 127.0.0.1:8080, apenas IP loopback), CAJUI_DB
(caminho do arquivo), CAJUI_API_TOKEN (mínimo 24 caracteres; usar segredo aleatório).
O processo não carrega .env automaticamente. Preserve o token no terminal de teste.

Em outro terminal, exporte o mesmo token e envie uma medição **simulada**:

```sh
curl --fail-with-body http://127.0.0.1:8080/api/v1/readings \
  -H "Authorization: Bearer $CAJUI_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}'
```

Atualize a página. Repetir o exemplo não duplica a medição; mude sequence para
uma nova amostra. Ctrl+C encerra o servidor; os dados permanecem no SQLite.

## Qualidade e estrutura

```sh
make check       # formatação, vet, testes com race e cobertura >= 80%
make build       # bin/cajui
# após os testes:
go tool cover -html=coverage.out
```

- cmd/cajui: inicialização e encerramento.
- internal/telemetry: contrato e validação.
- internal/storage: SQLite e evolução de schema.
- internal/httpapi: API e interface incorporada ao executável.
- internal/config: configuração validada.
- .github/workflows: CI preparada para GitHub (ainda não executada remotamente).

[Contrato da API](docs/api.md) · [Arquitetura](docs/architecture.md) ·
[Estado atual](docs/estado-atual.md) · [Contribuir](CONTRIBUTING.md) · [Segurança](SECURITY.md).

## Escopo e publicação

Próxima etapa: ponte da receptora → MQTT → ingestão, com medições reais e estados
de falha/comunicação. Cadastro, alertas, automações e autenticação de usuários ainda
não implementados. Windows e distribuição dedicada são possibilidades futuras.

Licenciado sob [Apache-2.0](LICENSE), conforme escolha do proprietário.
Repositório ainda local; definir URL pública e canal de segurança antes de publicar.
`cajui.local/server` é caminho de módulo provisório, substituível pelo endereço real.
