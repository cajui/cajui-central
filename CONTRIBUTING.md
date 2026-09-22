# Contribuir

Consulte README.md para executar. Use Go na versão indicada em go.mod.
Antes de propor alterações, rode `make check` e `make build`.

Mantenha PRs focados: problema, comportamento esperado e evidência de validação.
Mudanças de comportamento devem incluir testes relevantes. Testes de persistência
usam SQLite real em diretório temporário; testes HTTP usam httptest.
A CI exige formatação, go vet, detector de corridas e cobertura total mínima de 80%.
Esse limite é inicial: revisar cenários e efeitos colaterais continua obrigatório.

Não envie bancos pessoais, credenciais ou logs de dispositivos reais. Exemplos
precisam identificar dados simulados. Interfaces públicas e mudanças de schema
exigem documentação e compatibilidade planejada.

Código sob Apache-2.0. Contribuições devem ser compatíveis com essa licença.
Repositório ainda local; canal público de contribuição será definido ao publicar.
