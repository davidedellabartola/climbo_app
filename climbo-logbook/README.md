# Climbo Pisa · Digital Climb Logbook

Logbook boulder con sessioni, statistiche e **tracciatore di blocchi su foto**: carichi la foto della parete, tocchi le prese e il blocco viene salvato con coordinate in percentuale (x, y), quindi i cerchi restano sulle prese giuste su qualsiasi schermo.

**Stack:** Node.js 20 + Express · PostgreSQL 16 · HTML + Tailwind CSS + JavaScript vanilla · Docker Compose.

## Avvio

Requisiti: Docker con Compose v2.

```bash
cp .env.example .env        # poi modifica POSTGRES_PASSWORD (solo lettere e numeri)
docker compose up -d --build
```

Apri **http://localhost:3000** (porta modificabile con `APP_PORT` nel `.env`).

Al primo avvio viene creato lo schema del database e una parete demo, così puoi provare subito il tracciatore.

## Account e login

Alla prima apertura vedi la schermata di accesso: clicca **Registrati** e crea il tuo account (email + password di almeno 8 caratteri). Ogni utente vede solo le proprie sessioni, pareti e blocchi; la parete demo è condivisa. **Esci** è in alto a destra.

- Il **primo account** creato eredita automaticamente i dati inseriti prima dell'introduzione del login.
- Per chiudere le registrazioni dopo aver creato i tuoi account metti `ALLOW_REGISTRATION=false` nel `.env` e rilancia `docker compose up -d`.
- Password salvate con scrypt (mai in chiaro), sessione in cookie `httpOnly` valida 30 giorni, blocco temporaneo dopo 10 login errati.
- Le foto delle pareti sono servite solo agli utenti connessi.

## Uso

1. **Traccia blocco**: se la parete è troppo grande e le prese risultano piccole, passa a **Foto della via** e scatta o scegli una foto del solo blocco: i cerchi vengono segnati su quella foto, che diventa l'immagine della via (resta comunque associata alla parete). Altrimenti scegli la parete (o carica una foto JPG/PNG/WebP), seleziona il tipo di presa (verde Start, blu Intermedia, rosso Top) e tocca la foto. Tocca un cerchio per rimuoverlo. Dai un nome, scegli il grado stimato e salva. Servono almeno una presa Start e una Top.
2. **Le mie sessioni**: crea una sessione (data, palestra/settore, note) e aggiungi i blocchi: grado in scala Font, stile (Flash / Top / Tentativo) e numero di tentativi. Puoi scegliere uno dei tuoi blocchi tracciati: il grado si precompila.
3. **Le tue vie**: tutte le vie che hai tracciato, su tutte le pareti, con ricerca per nome, filtri per parete e grado e stato (Tutte / Da fare / Chiuse). Ogni scheda mostra se l'hai chiusa (Flash o Top) oppure è ancora da fare.
4. **Statistiche**: sessioni, blocchi chiusi, % di flash sui blocchi provati, grado massimo e piramide dei gradi.

## Dati e comandi utili

I dati stanno in due volumi Docker persistenti: `pgdata` (database) e `uploads` (foto). Sopravvivono a `docker compose down` e ai riavvii; `docker compose down -v` li cancella.

```bash
docker compose logs -f web                                  # log applicazione
docker compose exec db pg_dump -U climbo climbo_logbook > backup.sql   # backup database
docker compose up -d --build                                # aggiorna dopo modifiche al codice
```

## API REST

| Metodo | Rotta | Descrizione |
|---|---|---|
| GET | `/api/meta` | Gradi, stili e registrazioni aperte (pubblica) |
| POST | `/api/auth/register` · `/login` · `/logout` | Registrazione, accesso, uscita |
| GET | `/api/auth/me` | Utente connesso (401 se non loggato) |
| GET / POST | `/api/walls` | Elenco pareti / upload foto (`multipart`: `image`, `name`) |
| DELETE | `/api/walls/:id` | Elimina parete caricata, con i suoi blocchi e la foto |
| GET / POST | `/api/boulders` | Blocchi con prese / crea `{wall_id, name, grade, holds:[{type,x,y}]}` |
| GET / DELETE | `/api/boulders/:id` | Dettaglio blocco con salite registrate / elimina |
| GET / POST | `/api/sessions` | Sessioni con log / crea `{date, gym, notes}` |
| DELETE | `/api/sessions/:id` | Elimina sessione |
| POST | `/api/sessions/:id/logs` | Aggiungi `{grade, style, attempts, boulder_id?}` |
| DELETE | `/api/logs/:id` | Elimina log |
| GET | `/api/stats` | Statistiche e piramide |

`type` delle prese: `start`, `mid`, `top`; `x` e `y` sono percentuali 0–100 rispetto a larghezza e altezza dell'immagine.

## Note per la produzione

- **HTTPS**: se la esponi su internet mettila dietro un reverse proxy con HTTPS (es. Caddy o Traefik) e imposta `COOKIE_SECURE=true`.
- Tailwind e il font sono caricati da CDN per mantenere il progetto senza build step; per un uso offline compila il CSS con la CLI di Tailwind e self-hosta il font.
- I file caricati sono limitati per tipo (JPG/PNG/WebP) e dimensione (`MAX_UPLOAD_MB`, default 10).
