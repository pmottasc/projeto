# XML SEFAZ Worker

Worker Node.js que faz a chamada **mTLS** ao webservice oficial **NFeDistribuicaoDFe** (SEFAZ Nacional) usando o certificado digital A1 (.pfx) de cada empresa. Necessário porque as Supabase Edge Functions (Deno Deploy) não suportam client certificates customizados.

## Arquitetura

```
Front (React) ──► Edge Function `xml-api` ──► Worker (Railway) ──► SEFAZ
                          │                          │
                          └────► Supabase DB ◄───────┘  (NSU, docs, logs)
```

A edge function autoriza o usuário (RLS/tenant) e repassa o job para o worker. O worker:
1. Baixa o `.pfx` do bucket `digital-certificates`
2. Converte para PEM em memória
3. Faz POST SOAP mTLS na SEFAZ Nacional
4. Trata `cStat` 137 (vazio→cooldown 1h), 656 (consumo indevido→bloqueio 1h), 138 (docs encontrados)
5. Salva XMLs no bucket `xml-storage` e metadata em `xml_documentos`
6. Atualiza `ultimo_nsu_nfe`/`ultimo_nsu_cte` e libera o lock por CNPJ

## Endpoints

| Método | Rota              | Auth                          | Body                                              |
|--------|-------------------|-------------------------------|---------------------------------------------------|
| GET    | `/health`         | público                       | —                                                 |
| POST   | `/dfe/consultar`  | `x-worker-secret: <SECRET>`   | `{ "empresa_id": "uuid", "tipo": "NFE"\|"CTE" }` |

## Deploy no Railway (passo a passo)

1. **No Railway** → `New Project` → `Deploy from GitHub Repo` (selecione esse repo) OU `Empty Project` + `Deploy from local`
2. **Root directory**: `worker`
3. Em **Settings → Build**: deixe Railway detectar o `Dockerfile` automaticamente
4. Em **Variables**, defina:

   | Variável                       | Valor                                                            |
   |--------------------------------|------------------------------------------------------------------|
   | `WORKER_SECRET`                | uma string aleatória forte (`openssl rand -hex 32`)              |
   | `SUPABASE_URL`                 | `https://hoxmwmwxhmgdrupbmzht.supabase.co`                       |
   | `SUPABASE_SERVICE_ROLE_KEY`    | service role key da Supabase (Settings → API)                    |
   | `AMBIENTE`                     | `1` produção / `2` homologação                                   |

5. **Settings → Networking → Generate Domain** → copie a URL gerada (ex.: `xml-worker-production.up.railway.app`)
6. Volte aqui no Lovable e me passe:
   - **URL pública** do worker (com `https://` na frente)
   - **WORKER_SECRET** (o mesmo que você colocou na env do Railway)

Eu cadastro como `XML_WORKER_URL` e `XML_WORKER_SECRET` nos segredos da Supabase e a edge function passa a chamar o worker.

## Teste local

```bash
cd worker
npm install
WORKER_SECRET=devsecret \
SUPABASE_URL=https://hoxmwmwxhmgdrupbmzht.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
AMBIENTE=2 \
npm run dev

curl http://localhost:8080/health
```

## Segurança

- O worker só aceita requisições com o header `x-worker-secret` correto.
- Service role key fica apenas dentro do container — nunca exposta ao front.
- O `.pfx` é baixado por requisição, mantido em memória e descartado ao final.
- Logs não imprimem senha de certificado nem conteúdo do .pfx.
