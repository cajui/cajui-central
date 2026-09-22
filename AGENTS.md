# Desenvolvimento do Cajuí

Aplicação independente do firmware e do CAD do projeto Cajuí, mantidos fora deste repositório.
Notas de projeto do proprietário também ficam fora; não copiá-las para cá.
Nome público: **Cajuí Central**. Identificadores internos (módulo, pacotes, banco,
variáveis CAJUI_*) permanecem `cajui`; só interface e documentação usam o nome público.
Leia README.md e docs/estado-atual.md antes de alterar o projeto.

- Separe regras de domínio, transporte e persistência. Evite abstrações sem uso.
- Documente contratos e alterações de schema. Preserve medições e migrações existentes.
- Não registre tokens, não coloque credenciais no Git e não exponha a interface sem autenticação.
- Teste comportamento, falhas e persistência; não use cobertura como substituto de revisão.
- Execute make check e make build antes de entregar mudanças de código.
- Atualize estado atual com evidência e limitações. Não apresente dados simulados como físicos.
- Não altere firmware/CAD para acomodar esta aplicação sem tarefa específica.
