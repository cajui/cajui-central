# Segurança

Bootstrap para desenvolvimento local. O executável aceita somente loopback, salvo
com `CAJUI_ALLOW_NON_LOOPBACK=1`, previsto para contêineres: nesse caso a restrição
passa para a publicação da porta, que o `compose.yaml` faz apenas em `127.0.0.1` do
host. Não publique em `0.0.0.0` nem use a variável fora de contêiner.
Dashboard e healthcheck são públicos na máquina; a API exige Bearer token.
Não exponha via proxy/túnel: ainda não há login, TLS, papéis ou política de sessão.

Tokens devem ser gerados aleatoriamente e enviados por variável de ambiente.
Não compartilhe o token em issues, logs ou capturas. Antes da publicação, definir
canal privado para relatos e política de versões suportadas. Por enquanto,
reportar diretamente ao responsável pelo projeto, sem divulgar detalhes sensíveis.

Atualizações de dependências são propostas pelo Dependabot quando publicado no
GitHub. CI não substitui revisão de segurança nem auditoria das dependências.
