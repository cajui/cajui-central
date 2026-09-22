# Arquitetura inicial

Decisão de implementação de 2026-09-22: Go, SQLite e interface HTML incorporada.
Mosquitto/MQTT permanece integração seguinte; não é dependência do bootstrap.
Distribuição dedicada e instalador Windows adiados pelo proprietário.

Fluxo: adaptador HTTP → contrato telemetry → storage SQLite.
O contrato de Repository fica junto ao consumidor HTTP, sem framework/ORM.
Go é candidato à distribuição multiplataforma; este bootstrap não promete suporte
Windows. Driver SQLite modernc é Go sem cgo; o detector de corridas pode exigir C.

Medição identifica nó, sensor, sessão, sequência e métrica. Reinício do nó deve
mudar a sessão, não sua identidade. Retentativas idênticas não duplicam amostras;
mesma identidade com conteúdo diferente retorna conflito. Recebimento é registrado
pelo servidor e preservado nas retentativas; horário medido é opcional e não inferido.
Erro de sensor/ausência de leitura não é zero: não enviar uma medição inválida.
Contrato de status, unidades padronizadas e versão MQTT serão definidos na integração.

Schema inicial versionado por PRAGMA user_version, criado em transação. Schema
mais novo é rejeitado para evitar execução de binário antigo sobre banco incompatível.
SQLite usa WAL, uma conexão e timeout de bloqueio. Sem retenção automática nesta fase;
consultas limitadas às últimas 100 amostras. Não copiar apenas o .db durante escrita:
backup consistente e restauração serão implementados antes de operação contínua.

Interface de demonstração local, sem atualização automática nem indicador online.
Não há acoplamento ao protocolo LoRa; a ponte futura fará tradução e autenticação.
Antes de rede local multiusuário: login, credenciais por central, TLS quando aplicável,
limites de ingestão, autorização e política de retenção/backup.

Execução por contêiner (2026-09-22, pedido do proprietário para não instalar Go):
imagem em dois estágios, compilação estática sem cgo em `golang:1.27` e execução em
`distroless/static` como usuário não root, com dados em volume nomeado montado em
`/data`. O processo precisa escutar na interface do contêiner, por isso existe
`CAJUI_ALLOW_NON_LOOPBACK=1`; a garantia de loopback passa para o `compose.yaml`,
que publica a porta somente em `127.0.0.1` do host. Alternativa descartada: rede de
host do Docker, que preservaria o loopback do processo mas não funciona de forma
uniforme no Docker Desktop. Sem healthcheck na imagem: não há shell nem curl.

Referências: https://go.dev/doc/ ; https://pkg.go.dev/modernc.org/sqlite ;
https://www.sqlite.org/wal.html
