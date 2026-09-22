# API v1 — desenvolvimento local

GET /healthz: 200 se banco acessível, 503 caso indisponível.
GET /: interface HTML com últimas 100 medições (sem autenticação, apenas loopback).
GET /api/v1/readings: lista JSON, mais recentes por chegada primeiro; vazio é [].
POST /api/v1/readings: recebe um objeto JSON com Content-Type application/json.
Ambas as rotas /api exigem Authorization: Bearer <CAJUI_API_TOKEN>.

Exemplo simulado:
```json
{"node_id":"demo-node","sensor_id":"ambient","session_id":"boot-1","sequence":1,"metric":"temperature","value":26.7,"unit":"degC"}
```

IDs e métrica: 1–64 caracteres alfanuméricos, ponto, hífen, sublinhado ou dois-pontos;
primeiro caractere alfanumérico. sequence: inteiro >= 0. value: número finito,
obrigatório (zero válido). unit: 1–32 bytes. measured_at: opcional RFC3339 com fuso.
received_at é exclusivo de saída, atribuído pelo servidor em UTC.
Campos extras, objetos concatenados e payloads acima de 8 KiB são rejeitados.

201: criado; 200: retentativa idêntica, sem alterar horário de recebimento;
400: payload inválido; 401: token ausente/incorreto; 409: identidade já usada com
conteúdo diferente; 415: tipo de conteúdo inválido; 500: falha de armazenamento.
Identidade: node_id + sensor_id + session_id + sequence + metric.
Uma mesma amostra pode enviar temperature e humidity separadamente. Não há
transação multimétricas nem garantia de entrega fim a fim nesta API.
