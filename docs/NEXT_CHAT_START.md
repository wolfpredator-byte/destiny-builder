# DESTINY BUILDER — AVVIO RAPIDO NUOVA CHAT

**Versione:** 1.9 · **25 ottobre 2026** · ultimo checkpoint funzionale confermato: **SYNC-3b1**.  
**Task corrente:** **H1-A, verifica runner** (non chiuso).  
**Fonte di verità:** [`docs/ROADMAP.md`](ROADMAP.md) (fase ▶).  
**Memoria dettagliata e storico:** [`docs/DESTINY_BUILDER_PROJECT_MEMORY.md`](DESTINY_BUILDER_PROJECT_MEMORY.md), leggere sezione 0 e 27; le vecchie istruzioni sono storiche.

## Messaggio pronto da incollare nella nuova chat

> Continuiamo **Destiny Builder**, app locale Next.js 16.3.8/React 19/TypeScript, Windows 11 Node 24, repo pubblico `wolfpredator-byte/destiny-builder`, `C:\Projects\DestinyBuilder\destiny-builder`. **Non ricominciare:** SYNC-3b1 è l'ultimo checkpoint funzionale confermato dall'utente (Builder/Vault/Inspector condividono dettagli SQLite); Engine-B0.6a1/a2/a3 e SYNC-1→3b1 sono già implementati con i limiti dichiarati. **Leggi prima `docs/ROADMAP.md` (fase ▶), `AGENTS.md`, sezione 0 e 27 di `docs/DESTINY_BUILDER_PROJECT_MEMORY.md` e i file reali correnti.** Il task immediato è **H1-A**: correggere e collaudare su Windows `scripts/verify.mjs`, che deve generare `.next/verify-report.txt` anche su fallimento. Un primo tentativo di OpenCode/Ollama era difettoso, la patch corretta è stata preparata ma **non abbiamo ancora il collaudo Windows**. Su GitHub il runner è solo uno stub. Dopo H1-A: H1-B `npm run verify`, poi H2 documentazione, quindi **SYNC-3b2** (single-flight app, non implementata) e **B0.6a4** (applica Armor alla sola Builder Preview). Non scrivere a Bungie dall'Optimizer, non avviare chiamate OpenAI a pagamento, non inventare test PASS o certificazioni. Lavora a patch piccole, rispetta `AGENTS.md` e i doc Next locali, spiega il codice in italiano e riporta evidenza di test reale.

## Stato del progetto

| Area | Stato | Cosa significa |
|---|---|---|
| Base Bungie: OAuth, Guardian, Vault, trasferimenti separati | ✅ | Funzionante nelle verifiche utente precedenti |
| Build Assistant/Builder Preview e sottoclassi | ✅ / parziale | Preview e funzioni esistenti, non build AI pienamente certificata |
| Armor B0.6a1–a3 | ✅ | Ricerca combinazioni 5 pezzi con sei stat; niente certificazione dell'installabilità finale |
| SYNC-1 → SYNC-3a | ✅ | SQLite, snapshot protetti, cache persistente, smart refresh; osservata UI con 457 dettagli riutilizzati |
| SYNC-3b1 | ✅ | Cache-first condivisa in Builder, Vault, Inspector/Compare; «funziona tutto» utente; 18/18 controlli riferiti offline, **nessun nuovo log WIN** |
| **H1-A** | ▶ In verifica | Primo runner Ollama difettoso; report assente. Correzione preparata, Windows non ancora eseguito |
| H1-B | ⏳ | Comando npm `verify`, report e verifica commit |
| H2 | ⏳ | `STATE.md`, `DECISIONS.md`, `CHANGELOG.md`, storia conservata |
| SYNC-3b2 | ⏳ | Single-flight globale per account, progress/stop, Strict Mode, nessun duplicate worker |
| Engine-B0.6a4 | ⏳ | Applicazione solo a Builder Preview su conferma esplicita |
| MF-B1d | ⏸ | Manifest italiano, separato dalla sync |

## Repository/ambiente — verificato su GitHub al 25 ottobre

- **Repo pubblico**, branch `master`, commit osservato `95352c4bb5` («Cambiamenti roadmap e configurazione opencode»); non dedurre lo stato locale dal remoto.
- Roadmap **esiste in `docs/ROADMAP.md`**, NON in root; `CLAUDE.md` la richiama.
- `package.json`: Next `16.3.8`, React `19.2.8`, `tsx` già installata come devDependency con versione **`4.23.15`**. **Manca ancora `npm run verify`**.
- `opencode.json` ora usa `ollama/qwen3.5:4b`. Ollama/OpenCode è **strumento locale di sviluppo**, non AI automaticamente integrata nell'app.
- `scripts/verify.mjs` remoto al commit osservato è solo un prologo/import. Il nuovo hotfix H1-A fornito in ZIP è **da applicare e collaudare**. Una precedente risposta OpenCode indicava 21 suite, ma le 18 suite `test-*.ts` della root non erano state effettivamente eseguite/provate da quel runner. Esiti dell'agente non sono prove.
- `CLAUDE.md` contiene un frammento accidentale `~~~` di istruzioni su come salvare la roadmap; pulizia **separata**, non inclusa in H1-A.
- Il precedente `git status` con file modificati/eliminati risale a prima dell'ultimo commit; ricontrollare sempre `git status --short` prima di applicare patch e non ripristinare file senza approvazione.

## Passo immediato per riprendere H1-A

Usare la patch **`DestinyBuilder_H1_A_Verify_Runner_Fix.zip`** già consegnata, se non installata. Confrontare il file attuale, salvare una copia, sostituire **solo** `scripts/verify.mjs` e controllare in PowerShell:

```powershell
node --check .\scripts\verify.mjs
node .\scripts\verify.mjs
Write-Host 'Exit code:' $LASTEXITCODE
Get-Content .\.next\verify-report.txt
git status --short
```

Criteri H1-A: individuare dinamicamente **18** suite nella root, eseguire `next typegen`, `tsc --noEmit` e tutte le suite con exit code reali, non falsificare conteggi; scrivere report UTC/Node/commit/risultati anche in caso di fallimento; niente dati personali. **Non dichiarare H1-A completato prima di vedere output Windows e report.** Solo allora H1-B aggiunge `npm run verify`.

## Limiti e salvaguardie

`docs/ROADMAP.md` autorizza la sequenza. Niente nuove feature fuori fase; nuovi spunti al backlog. Non alterare trasferimenti del Vault, autenticazione Bungie, `armorOptimizer.ts` legacy, SQLite o Builder Preview per fare H1. Non affermare installabilità quando `certifiedForOptimization:false`; `unknown` resta `unknown`. Separare static Manifest, live Bungie, cache privata. Evitare log con token, ID Bungie/itemInstanceId; nessun upload di `.env*` o SQLite. Prima di patch Next.js leggere la guida locale `node_modules/next/dist/docs/`. Mantenere commenti didattici in italiano. Non usare commit/restore/reset Git distruttivi senza autorizzazione.

**Questi file scaricabili sono copie di checkpoint:** non modificano automaticamente Windows/GitHub. Applicarli in `docs/`, controllando `git diff` prima di committare. Per un nuovo lavoro partire dalla roadmap e dai file correnti.
