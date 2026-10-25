# DESTINY BUILDER — ROADMAP

> **Fonte di verità del progetto**, letta da `CLAUDE.md`.  
> **Versione:** 1.1 — 25 ottobre 2026 · checkpoint manutenzione H1-A.  
> **Memoria e prove:** `docs/DESTINY_BUILDER_PROJECT_MEMORY.md` v1.9 (sezioni 0 e 27 per stato attuale).  
> **Handoff:** `docs/NEXT_CHAT_START.md` v1.9.  
> **Collocazione canonica:** `docs/ROADMAP.md` (**non** `ROADMAP.md` in root).

---

## 1. Regole della roadmap

1. Questa roadmap decide **cosa è autorizzato ora**: eseguire soltanto la fase **▶ ATTIVA**. H1/H2 sono checkpoint brevi di manutenzione **approvati dall'utente**, non permessi generali per nuove feature.
2. Le idee nuove vanno nel backlog (§6), salvo bug, regressioni, sicurezza o dipendenze bloccanti. Niente refactoring massivo.
3. Una modifica mirata per task; prima leggere file installati, `AGENTS.md`, le istruzioni di `CLAUDE.md` e, per Next.js, documentazione locale `node_modules/next/dist/docs/`.
4. Dopo una patch: test effettivi, exit code, report e collaudo sul Windows dell'utente quando serve. **WIN ≠ OFF ≠ UI**.
5. Non dedurre lo stato dalla cronologia Git. Prima di sovrascrivere file verificare `git status --short` e `git diff`. Non fare commit/push se non richiesti.
6. Al termine di ogni fase, aggiornare questa roadmap e il checkpoint, idealmente nello stesso commit autorizzato.
7. Il codice presente nell'ultima versione GitHub potrebbe non corrispondere al workspace locale: la prova finale è sul file realmente installato.

### Legenda ed evidenza

| Simbolo | Significato |
|---|---|
| ✅ | Chiuso, con prove documentate e/o conferma d'uso |
| ▶ | Fase **attiva e autorizzata** |
| ⏳ | Pianificato, non iniziare ora |
| ⏸ | Separato/sospeso |
| 💡 | Backlog, non autorizzato |

**WIN** = test eseguito dall'utente in PowerShell su Windows; **OFF** = test eseguito offline dall'assistente; **UI** = conferma dell'utente nel browser. Non sommare prove diverse come se fossero lo stesso run.

---

## 2. Obiettivo di prodotto

App web Destiny 2 collegata all'account Bungie che legge Guardian, inventari e Vault e propone build **basate su ciò che il giocatore possiede o ha sbloccato**, nei limiti dei dati verificati. Tre classi (Titan, Hunter, Warlock); sei sottoclassi (Arc, Solar, Void, Stasis, Strand, Prismatic).

- L'Optimizer può proporre simulazioni e modificare **solo** la Builder Preview locale, su azione esplicita; non scrive su Bungie.
- Un suggerimento AI è un'ipotesi non fidata finché i validator locali non la approvano.
- `unknown` non diventa automaticamente `passed`, `locked` o `0`.

---

## 3. Fasi completate (non ripetere senza regressioni)

### Fondamenta e Manifest

| Fase | Risultato | Evidenza sintetica |
|---|---|---|
| ✅ Base app | OAuth Bungie e refresh, Guardian, Inventario, Vault, Inspector, trasferimenti espliciti, Builder e AppShell | Conferme UI precedenti; per dettagli vedere memoria |
| ✅ MF-A / MF-A1a / MF-A1b | Manifest versionato, cache per richiesta, indagine sul Manifest italiano | Memoria v1.9; MF-B1d separato |

### Armor Engine

| Fase | Risultato | Evidenza |
|---|---|---|
| ✅ B0.5b2–b6 | Disponibilità mod / PlugSet, audit live conservativo | WIN 30/30 (b2), audit 4/4 (b3–b6) |
| ✅ B0.5c1–c3a | Validator di installabilità conservativo e consistenza evidenze | WIN 124/124 + tsc (17/10) |
| ✅ B0.5c3b–c3e | Controlli socket/PlugSet; nessuna falsa installabilità | Audit 4/4 (18/10), WIN 65/65 + tsc |
| ✅ B0.6a1 | `armorCombinationEngine.ts`, cinque slot, sei Min/Max Armor 3.0, esotiche, pin/budget | WIN 25/25 + tsc |
| ✅ B0.6a2 | UI bridge e ricerca B0.6 | WIN 40/40 + tsc, screenshot UI |
| ✅ B0.6a3 | `armorEquippedSnapshot.ts`, equipaggiamento riconciliato e coda dettagli | WIN 56/56 + tsc |

**Invarianti:** `overallInstallable:false`, `installabilityVerified:false`, `certifiedForOptimization:false` in assenza di prove; legacy `armorOptimizer.ts` invariato.

### SQLite e sincronizzazione

| Fase | Risultato | Evidenza |
|---|---|---|
| ✅ SYNC-1 | SQLite `node:sqlite` per account, dettagli privati, senza token | WIN 19/19 + tsc |
| ✅ SYNC-2a | Coda incrementale, max 2 parallele, batch 32 | WIN 38/38 + tsc |
| ✅ SYNC-2b | Bridge Bungie autenticato, `scope=cached-details` | WIN 66/66 + tsc |
| ✅ SYNC-2c + hotfix | Auto-hydration Armor v2, fix falsi oggetti ricomparsi | WIN 86/86 + tsc; OFF 94/94; UI 457 cache/0 nuovi/5 armature |
| ✅ SYNC-3a | Smart refresh, ricontrolli limitati e scadenze | OFF 113/113, UI «funziona» |
| ✅ SYNC-3b1 | Lettura cache-first in Builder, Vault, Inspector/Compare | OFF 18/18, UI «funziona tutto» |

**Nota di precisione:** per SYNC-3a e SYNC-3b1 non è stato fornito un nuovo log di tutte le suite WIN. Non inventarlo.

---

## 4. ▶ FASE ATTIVA — H1: runner di verifica riproducibile (manutenzione autorizzata)

**Motivo:** eliminare falsi «PASS» dichiarati dagli agenti locali, rendere riproducibili i controlli su un clone pulito, recuperare un report associato al commit realmente verificato. **Non è una nuova feature Destiny** e non autorizza refactoring in Bungie/Builder/Armor.

### ▶ H1-A — `scripts/verify.mjs` (IN VERIFICA, non chiuso)

**Stato osservato (25/10):** il primo script creato da OpenCode/Ollama **non** ha generato `.next/verify-report.txt` dopo l'esecuzione Windows. `node --check` riuscito ≠ verifica funzionale. Il log agente dichiarava 21 suite senza prova. Sul repository remoto il file `scripts/verify.mjs` è ancora un prologo incompleto. È stata consegnata una **patch hotfix singolo-file**, riferita come testata in 4 scenari simulati offline; **manca conferma Windows**.

**Scope consentito ora:** solo `scripts/verify.mjs`. Le modifiche precedenti a `package.json`/`package-lock.json` per `tsx` sono già presenti nel remoto; `tsx` è `4.23.15` devDependency esatta. Non installare altre dipendenze.

**Criteri di uscita:**

1. `node --check scripts/verify.mjs` exit 0.
2. `node scripts/verify.mjs` effettua `next typegen`, `tsc --noEmit`, scopre **dinamicamente** le 18 suite `test-*.ts` della root e le esegue usando `tsx` locale; nessuna lista fissa.
3. Usa gli **exit code veri**, senza inferire PASS dal testo. Fermo al primo errore/timeout. Non inventa il numero di assert nelle suite prive di verifica esplicita.
4. Scrive `.next/verify-report.txt` **sia su PASS sia su FAIL**, con data UTC, Node, commit Git, singoli esiti; niente token/account ID/log privati.
5. Il report è stato **eseguito e letto su Windows dall'utente**; condivisione dei risultati e `git status --short` prima di dire H1-A chiuso.

```powershell
node --check .\scripts\verify.mjs
node .\scripts\verify.mjs
Write-Host 'Exit code:' $LASTEXITCODE
Get-Content .\.next\verify-report.txt
git status --short
```

### ⏳ H1-B — comando npm e report checkpoint

**Non partire prima di H1-A:** aggiungere a `package.json` lo script `"verify": "node scripts/verify.mjs"` senza altre modifiche, confermare `npm run verify` ed eventuali modifiche strettamente necessarie al lockfile; conservare report ed esaminare Git diff, creare tag/commit solo se autorizzati. Non migrare ancora i test dalla root.

---

## 5. Sequenza successiva, non autorizzata finché H1-A non è chiuso

| Ordine | Fase | Stato e uscita |
|---|---|---|
| 1 | **H1-B** — attivare `npm run verify` | ⏳ Dopo H1-A; report ed exit code verificati |
| 2 | **H2** — documentazione chiara e corta | ⏳ `STATE.md` (1 pagina), `DECISIONS.md` append-only, `CHANGELOG.md` archivio; mantenere fonti e storia, non cancellare il documento lungo finché non verificato |
| 3 | **SYNC-3b2** — coordinatore unico per account | ⏳ Single-flight tra Builder/Vault/Armor, un solo worker, guard di identità e remount Strict Mode, stop/abort/progress, no richieste doppie o download massivi se SQLite fallisce |
| 4 | **Engine-B0.6a4** — applicazione combinazione Armor | ⏳ Solo Builder Preview locale dopo conferma; niente equip/transfer Bungie |
| — | **MF-B1d** — Manifest italiano | ⏸ Separato, non sovrapporlo alla sync |

**SYNC-3b2, quando autorizzata:** prima leggere `AppShell.tsx`, `src/app/layout.tsx`, `assistant-v2/page.tsx`, `itemDetailClientSync.ts` (e solo i moduli vicini necessari). Criteri osservabili da formalizzare nei test: Builder→Vault→Armor non ripete `GetItem` per un dettaglio valido; Strict Mode/remount non crea worker paralleli; un cambio account non idrata stato altrui; cambio Guardian non introduce risultati obsoleti; stop e limiti di rete rispettati. Nessun secondo flusso automatico parallelo ad Armor v2. Nessuna sync globale massiva non approvata.

---

## 6. Backlog 💡 (non autorizzato)

- Certificazione installabilità Armor 3.0 completa, con evidenza energia/costi/tier/masterwork/slot/sblocchi.
- Migrazione graduale dei test a `tests/` e valutazione `node --test` dopo H1, solo con dimostrata compatibilità.
- Estrarre logica pura dai grandi file React/route **solo** quando una modifica utile lo richiede; niente big-bang.
- Fixture anonime per audit reali, backup SQLite ricostruibile (con privacy), eventuale CI GitHub.
- Acquisition Planner, progressione Potere, lore e portale enciclopedico. Controllare licenze/termini prima di integrare contenuti terzi.
- Pulizia frammento accidentale di istruzioni in `CLAUDE.md`, come modifica separata.

---

## 7. Sicurezza e privacy non negoziabili

- Nessuna scrittura Bungie (equip/transfer/socket) dall'Optimizer; i trasferimenti Vault sono un flusso separato e intenzionale.
- Nessuna chiamata OpenAI a pagamento senza approvazione; Ollama/OpenCode serve per il **coding locale**, non implica AI in-app.
- Nessuna nuova dipendenza npm senza approvazione; `tsx` già dichiarata.
- Nessun token, OAuth, ID account/Guardian/itemInstanceId, `.env` o database privati in log, report, export o contesto AI.
- Cache SQLite privata separata dal Manifest; dato cached ≠ Bungie live.
- `unknown` resta `unknown`; non certificare configurazioni con dati insufficienti.
- Niente operazioni Git distruttive, push o commit automatici; controllare diff e backup.

---

## 8. Regressioni disponibili e verifica H1

La verifica corrente è ancora manuale finché H1-A/H1-B non superano il collaudo Windows:

```powershell
npx --no-install next typegen
npx --no-install tsc --noEmit
npx --no-install tsx test-shared-item-detail-cache.ts
npx --no-install tsx test-item-detail-smart-refresh.ts
npx --no-install tsx test-item-detail-full-snapshot-regression.ts
npx --no-install tsx test-item-detail-client-sync.ts
npx --no-install tsx test-item-detail-profile-bridge.ts
npx --no-install tsx test-item-detail-sync.ts
npx --no-install tsx test-item-detail-store.ts
npx --no-install tsx test-armor-combination-engine.ts
npx --no-install tsx test-armor-combination-ui-bridge.ts
npx --no-install tsx test-armor-equipped-snapshot.ts
npx --no-install tsx test-armor-installability-validator.ts
```

Dopo H1-B, il comando canonico sarà `npm run verify` e dovrà scrivere un report reale; **non affermare che sia già disponibile**. Per un log affidabile salvare commit esatto, versione Node, output e exit code; una suite con exit 0 ma senza assert non ha un numero PASS verificato.
