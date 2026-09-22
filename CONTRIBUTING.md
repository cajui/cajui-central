# Contribuir

Consulte README.md para executar. Use Go na versão indicada em go.mod, ou
`make docker-check` para rodar as mesmas verificações em contêiner, sem Go local.
Antes de propor alterações, rode `make check` e `make build`.

Mantenha PRs focados: problema, comportamento esperado e evidência de validação.
Mudanças de comportamento devem incluir testes relevantes. Testes de persistência
usam SQLite real em diretório temporário; testes HTTP usam httptest.
A CI exige formatação, go vet, detector de corridas, cobertura total mínima de 80%
e construção da imagem Docker.
Esse limite é inicial: revisar cenários e efeitos colaterais continua obrigatório.

Não envie bancos pessoais, credenciais ou logs de dispositivos reais. Exemplos
precisam identificar dados simulados. Interfaces públicas e mudanças de schema
exigem documentação e compatibilidade planejada.

Código sob Apache-2.0. Contribuições devem ser compatíveis com essa licença.
Repositório: https://github.com/romulostorel/cajui-central. Issues e PRs pelo GitHub.
