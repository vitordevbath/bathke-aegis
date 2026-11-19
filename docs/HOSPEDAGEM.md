# Hospedagem com HTTPS

Como publicar o Aegis com TLS (ADR-055). O modo HTTP de `compose.yaml` continua sendo o padrão para
desenvolvimento e para o `npm run test:infra`; HTTPS entra por cima, com `compose.tls.yaml`.

```
                      :80  ──► 301 para HTTPS  (exceto /.well-known/acme-challenge/)
Internet ──► nginx ──┤
                      :443 ──► TLS 1.2/1.3 + HSTS ──► web (SPA) · /api/ → api
```

**Estado:** a configuração TLS é **IMPLEMENTADA** e testada no CI (`npm run test:infra` sobe a stack,
gera um certificado autoassinado e verifica redirecionamento, cabeçalhos, versões de TLS e a cadeia).
A hospedagem pública da demonstração **ainda não existe**: este guia é o caminho para fazê-la.

## O que você precisa

- Um servidor Linux com Docker e Docker Compose (uma VPS pequena basta: 2 GB de RAM).
- Para Let's Encrypt: um domínio com registro **A** (e **AAAA**, se houver IPv6) apontando para o
  servidor, e as portas **80** e **443** liberadas no firewall.

## 1. Configurar o `.env`

Copie `.env.example` para `.env` e preencha as senhas como no README. Para HTTPS, acrescente:

```dotenv
AEGIS_HTTP_PORT=80
AEGIS_HTTPS_PORT=443
AEGIS_SERVER_NAME=aegis.seudominio.com.br
# Pasta dos certificados no servidor (ignorada pelo Git). Padrão: ./certs
AEGIS_TLS_DIR=./certs
```

## 2. Primeiro certificado: autoassinado

O Nginx precisa de um certificado para subir. Gere um provisório (30 dias, chave EC P-256, `privkey.pem`
com permissão 600; a chave nunca é exibida):

```bash
npm run tls:self-signed -- aegis.seudominio.com.br
docker compose -f compose.yaml -f compose.tls.yaml up -d --build
```

Sem Node no servidor, gere o par com OpenSSL diretamente (mesmo resultado):

```bash
mkdir -p certs/acme
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -sha256 -days 30 \
  -subj "/CN=aegis.seudominio.com.br" \
  -addext "subjectAltName=DNS:aegis.seudominio.com.br,DNS:localhost,IP:127.0.0.1" \
  -keyout certs/privkey.pem -out certs/fullchain.pem && chmod 600 certs/privkey.pem
```

Para um **laboratório sem domínio**, pare aqui: o navegador vai avisar que o certificado não é
confiável, e o Aegis Collector **recusa** a conexão (ele só aceita certificados válidos para o sistema,
sem opção de desligar). Para o Collector aceitar, a máquina dele precisa confiar nesse certificado:

```bash
# Fedora, na máquina do Collector (copie apenas o fullchain.pem, nunca a chave)
sudo trust anchor --store fullchain.pem
```

## 3. Certificado real: Let's Encrypt

Com o DNS apontando e a stack no ar (passo 2), o certbot valida o domínio pelo desafio HTTP-01 que o
Nginx serve em `/.well-known/acme-challenge/`:

```bash
docker compose -f compose.yaml -f compose.tls.yaml --profile letsencrypt run --rm certbot \
  certonly --webroot -w /var/www/acme -d aegis.seudominio.com.br \
  --email voce@seudominio.com.br --agree-tos --no-eff-email
```

Aponte o Nginx para o certificado emitido, no `.env`:

```dotenv
AEGIS_TLS_CERT=/etc/nginx/tls/letsencrypt/live/aegis.seudominio.com.br/fullchain.pem
AEGIS_TLS_KEY=/etc/nginx/tls/letsencrypt/live/aegis.seudominio.com.br/privkey.pem
```

e recrie só o Nginx (as variáveis são aplicadas na inicialização do container):

```bash
docker compose -f compose.yaml -f compose.tls.yaml up -d nginx
```

## 4. Renovação

Os certificados do Let's Encrypt valem 90 dias. Agende, por exemplo com `crontab -e` (duas vezes ao
dia, como a própria Let's Encrypt recomenda):

```cron
17 3,15 * * * cd /caminho/do/bathke-aegis && docker compose -f compose.yaml -f compose.tls.yaml --profile letsencrypt run --rm certbot renew --quiet && docker compose -f compose.yaml -f compose.tls.yaml exec nginx nginx -s reload
```

## 5. Conferir

```bash
curl -sI http://aegis.seudominio.com.br/ | head -3        # 301 para https://
curl -sI https://aegis.seudominio.com.br/api/health       # 200, strict-transport-security
```

Os mesmos itens que o CI verifica: redirecionamento de toda rota (com caminho e query) para HTTPS,
desafio ACME fora do redirecionamento, HSTS de um ano, a mesma CSP e os mesmos cabeçalhos do modo HTTP
(vêm de um único arquivo, `infra/nginx/snippets/security-headers.conf`), TLS 1.3 por padrão, TLS 1.2
aceito e TLS 1.1 recusado pelo servidor.

## Decisões deixadas para o dono do domínio

- **HSTS** vale só para o host, por um ano. `includeSubDomains` e `preload` afetam outros serviços do
  domínio e são difíceis de desfazer; ligue apenas sabendo disso.
- **AEGIS DEMO** público: toda conta recebe acesso de leitura ao workspace de demonstração (ADR-052).
  Antes de abrir o cadastro na internet, decida se quer o demo ligado (`DEMO_WORKSPACE=on|off`) e se o
  host real `aegis-server` deve ser pareado (ele mostra boot e serviços do próprio servidor).
- **Backups** do volume `mysql_data` são responsabilidade de quem hospeda: o projeto ainda não tem
  rotina de backup do banco (`scripts/backup.ps1` só empacota o código-fonte).
