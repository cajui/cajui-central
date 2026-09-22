# Desenvolvimento do Cajuí Central

Servidor local de monitoramento: recebe medições por API HTTP, guarda em SQLite e
mostra numa interface web incorporada. Leia README.md e docs/ antes de alterar.

- Nome público: Cajuí Central. Identificadores internos (módulo, pacotes, banco,
  variáveis CAJUI_*) permanecem `cajui`; só interface e documentação usam o nome público.
- Separe regras de domínio, transporte e persistência. Evite abstrações sem uso.
- Documente contratos e alterações de schema. Preserve medições e migrações existentes.
- Não registre tokens, não coloque credenciais no Git e não exponha a interface sem autenticação.
- Teste comportamento, falhas e persistência; cobertura não substitui revisão.
- Execute make check e make build (ou make docker-check) antes de entregar mudanças de código.
- Atualize docs/estado-atual.md com evidência e limitações; distinga dados de exemplo de medições reais.
- Documentação e mensagens de commit descrevem apenas este repositório.
