# Cajuí

Plataforma local de monitoramento, independente do hardware dos sensores.
Bootstrap em desenvolvimento; ainda não controla atuadores nem recebe dados por MQTT.

## Executar

### Com Docker (não exige Go)

Requisitos: Docker com Compose v2.

```sh
cp .env.example .env     # preencha CAJUI_API_TOKEN com: openssl rand -hex 32
docker compose up --build
```

Abra http://127.0.0.1:8080. O banco fica no volume Docker `cajui-data`, que sobrevive
a reinícios e a reconstruções da imagem; `docker compose down -v` o apaga. Ctrl+C
encerra; `docker compose up -d` deixa em segundo plano e o serviço volta junto com o
Docker. `CAJUI_PORT` no `.env` muda a porta do host (padrão 8080).

O Compose lê `.env` para preencher as variáveis; o executável em si não lê `.env`.
Dentro do contêiner o processo escuta em `0.0.0.0` com `CAJUI_ALLOW_NON_LOOPBACK=1`,
mas a porta é publicada apenas em `127.0.0.1` do host. Não publique em `0.0.0.0`.

### Com Go local

Requisitos: Go 1.27+, Make; toolchain C para `go test -race`.

```sh
export CAJUI_API_TOKEN="$(openssl rand -hex 32)"
make run
```

Abra http://127.0.0.1:8080. Banco criado em `data/cajui.db`.
Variáveis: CAJUI_ADDR (padrão 127.0.0.1:8080, apenas IP loopback), CAJUI_DB
(caminho do arquivo), CAJUI_API_TOKEN (mínimo 24 caracteres; usar segredo aleatório),
CAJUI_ALLOW_NON_LOOPBACK (somente `1`, previsto para contêineres; ver Segurança).
Preserve o token no terminal de teste.

### Enviar uma medição simulada

Em outro terminal, exporte o mesmo token e envie:

```sh
curl --fail-with-body http://127.0.0.1:8080/api/v1/readings \
  -H "Authorization: Bearer $CAJUI_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}'
```

Atualize a página. Repetir o exemplo não duplica a medição; mude sequence para
uma nova amostra. Os dados permanecem no SQLite após encerrar o servidor.

## Qualidade e estrutura

```sh
make check          # formatação, vet, testes com race e cobertura >= 80%
make build          # bin/cajui
make docker-check   # o mesmo make check dentro de golang:1.27, sem Go local
make docker-build   # imagem cajui:local
# após os testes:
go tool cover -html=coverage.out
```

- cmd/cajui: inicialização e encerramento.
- internal/telemetry: contrato e validação.
- internal/storage: SQLite e evolução de schema.
- internal/httpapi: API e interface incorporada ao executável.
- internal/config: configuração validada.
- Dockerfile e compose.yaml: imagem estática sem root e execução local.
- .github/workflows: CI preparada para GitHub (ainda não executada remotamente).

[Contrato da API](docs/api.md) · [Arquitetura](docs/architecture.md) ·
[Estado atual](docs/estado-atual.md) · [Contribuir](CONTRIBUTING.md) · [Segurança](SECURITY.md).

## Escopo e publicação

Próxima etapa: ingestão por MQTT, com medições reais e estados de falha e
comunicação. Cadastro, alertas, automações e autenticação de usuários ainda não
implementados.

Licenciado sob [Apache-2.0](LICENSE).
Repositório ainda local; definir URL pública e canal de segurança antes de publicar.
`cajui.local/server` é caminho de módulo provisório, substituível pelo endereço real.
