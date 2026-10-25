# DESTINY BUILDER — ROADMAP

> **Fonte di verità del progetto** (richiamata da `CLAUDE.md`).
> **Versione:** 1.0 — allineata a `docs/DESTINY_BUILDER_PROJECT_MEMORY.md` v1.8 (20/10/2026, dopo SYNC-3b1).
> **Dettagli, prove complete e storico decisioni:** `docs/DESTINY_BUILDER_PROJECT_MEMORY.md`, sezioni 0 e 21–26.
> **Avvio rapido per nuove chat:** `docs/NEXT_CHAT_START.md`.

---

## 1. Regole di uso

1. Questa roadmap decide **cosa si può implementare ora**. Una fase non elencata come **ATTIVA** non si implementa.
2. Le idee nuove vanno nel **Backlog** (§6). Possono interrompere la fase attiva solo bug, regressioni, problemi di sicurezza o dipendenze bloccanti.
3. Una modifica controllata per volta, preferibilmente un file per task. Niente refactoring estesi.
4. Prima di modificare un file, leggere la sua versione attuale, `AGENTS.md` e, per Next.js, `node_modules/next/dist/docs/`.
5. Dopo ogni patch: `npx tsc --noEmit`, test mirati e, dove serve, collaudo nel browser su Windows. Indicare sempre **chi** ha eseguito **quali** test.
6. Non dedurre la fase corrente dai commit Git: vale questa roadmap.
7. Aggiornare questo file **solo** quando una fase viene chiusa o approvata dall'utente, nello stesso commit della modifica.

### Legenda

| Simbolo | Significato |
|---|---|
| ✅ | Completata, con prova riportata |
| ▶ | **Fase attiva**: l'unica autorizzata |
| ⏳ | Pianificata, non ancora autorizzata |
| ⏸ | Separata o sospesa |
| 💡 | Visione futura: **non** è un'autorizzazione a programmarla |

### Tipi di prova

| Sigla | Significato |
|---|---|
| **WIN** | Test o `tsc` eseguiti dall'utente in PowerShell su Windows |
| **OFF** | Test eseguiti offline dall'assistente (non equivalenti a WIN) |
| **UI** | Conferma d'uso dell'utente nel browser (non equivale a un test CLI) |

---

## 2. Obiettivo del prodotto (perimetro attuale)

App web Destiny 2 collegata all'account Bungie: legge Guardian, equipaggiamento, inventari e Vault, e **ottimizza le build solo con ciò che il giocatore possiede o ha sbloccato**, nella misura in cui i dati sono verificabili.

- Classi: Titan, Hunter, Warlock. Sottoclassi: Arc, Solar, Void, Stasis, Strand, Prismatic.
- L'Optimizer **non scrive mai su Bungie**: solo simulazioni e Builder Preview locale.
- Un suggerimento AI **non è una build certificata**: i controlli locali deterministici restano obbligatori.

---

## 3. Fasi completate

### Fondamenta
| Fase | Contenuto | Prova |
|---|---|---|
| ✅ Base app | OAuth Bungie e refresh, API profilo/inventario, Builder, Vault, AppShell | commit `Add Bungie auth and Guardian build UI` |
| ✅ MF-A / MF-A1a / MF-A1b | Cache versionata del Manifest, cache generica per richiesta, prova del Manifest italiano in sola lettura | registrata nella memoria v1.8 |

### Armor Engine
| Fase | Contenuto | Prova |
|---|---|---|
| ✅ B0.5b2–b6 | Disponibilità delle mod (installate, live, Manifest, bloccate, unknown); integrazione dei PlugSet condivisi | WIN 30/30 (b2); audit reale 4/4 (b3–b6) |
| ✅ B0.5c1–c3a | Validator di installabilità conservativo | WIN 124/124 + tsc (17/10) |
| ✅ B0.5c3b–c3e | Evidenze socket/PlugSet; gate prudente sul socket | audit 4/4 (18/10); WIN 65/65 + tsc |
| ✅ B0.6a1 | `armorCombinationEngine.ts`: ricerca su 5 slot, Min/Max sulle 6 stat Armor 3.0, una esotica, pin, budget | WIN 25/25 + tsc |
| ✅ B0.6a2 | `armorCombinationUiBridge.ts` + UI “Cerca B0.6 · Min/Max” | WIN 40/40 + tsc; screenshot UI |
| ✅ B0.6a3 | `armorEquippedSnapshot.ts` + coda manuale (32 dettagli, concorrenza 2) | WIN 56/56 + tsc |

Invarianti: `overallInstallable:false`, `installabilityVerified:false` e `certifiedForOptimization:false` finché non c'è una prova. `armorOptimizer.ts` legacy resta invariato.

### Sincronizzazione dei dettagli degli oggetti (SQLite)
| Fase | Contenuto | Prova |
|---|---|---|
| ✅ SYNC-1 | `itemDetailStore.ts`: `node:sqlite`, separato per account, senza token | WIN 19/19 + tsc |
| ✅ SYNC-2a | `itemDetailSync.ts`: coda incrementale (concorrenza 2, batch 32) | WIN 38/38 + tsc |
| ✅ SYNC-2b | Route autenticata, `scope=cached-details` | WIN 66/66 + tsc |
| ✅ SYNC-2c + hotfix | Caricamento automatico iniziale in Armor v2; fix del falso “sparito/ricomparso” negli snapshot completi | WIN 86/86 + tsc; hotfix OFF 94/94; UI: 457 dalla cache, 0 nuovi, 5/5 equipaggiati |
| ✅ SYNC-3a | Aggiornamento intelligente (equipaggiati ~6 h, altri ~3 giorni, limite ~30 giorni, max 8 ricontrolli per apertura) | OFF 113/113; UI «funziona» |
| ✅ SYNC-3b1 | `sharedItemDetailCache.ts`: lettura cache-first condivisa tra Builder, Vault Inspector e Compare Tray | OFF 18/18; UI «funziona tutto» |

Nota: per SYNC-3a e SYNC-3b1 **non c'è ancora un log WIN**. Va eseguito prima di dichiararli coperti da test CLI.

---

## 4. ▶ FASE ATTIVA — SYNC-3b2: coordinatore di sincronizzazione a livello app

**Stato:** non implementata.

**Obiettivo:** un unico coordinatore di sync per account, valido per tutta l'app. Passando tra Builder, Vault e Armor Optimizer non deve ripartire un download duplicato. Usa lo snapshot Bungie, SQLite e il confronto per istanza, con concorrenza e budget limitati, avanzamento e annullamento visibili.

**Prima di scrivere codice, leggere le versioni attuali di:**
1. `src/components/destiny-builder/AppShell.tsx`
2. `src/app/layout.tsx`
3. `src/app/guardian/[characterId]/assistant-v2/page.tsx`
4. `src/lib/destiny-builder/itemDetailClientSync.ts`

Solo se serve: `sharedItemDetailCache.ts`, `itemDetailStore.ts`, `inventory/route.ts`.

**Requisiti:**
- un solo flusso attivo per account (single-flight); gestione di remount, navigazione e cambio Guardian;
- avanzamento, stop, budget e rate limit;
- se la cache fallisce, **niente** ondata di richieste a Bungie;
- nessun secondo flusso automatico in parallelo alla sync di Armor v2;
- preservare il comportamento cache-first di SYNC-3b1;
- nessuna sync globale automatica all'avvio finché l'utente non ha capito i limiti della prima importazione.

**Sequenza:** ispezione in sola lettura → test puri (ciclo di vita, single-flight/abort, privacy) → una patch per volta → `tsc` + suite di regressione → collaudo nel browser su Windows.

**Fuori perimetro in questa fase:** trasferimenti del Vault, persistenza delle bozze e Builder Preview, `armorOptimizer.ts` legacy, installabilità, Manifest, schema del DB.

---

## 5. Fasi successive

| Ordine | Fase | Stato | Note |
|---|---|---|---|
| 1 | **Engine-B0.6a4** — applicare una combinazione Armor alla **sola Builder Preview locale**, su conferma esplicita | ⏳ dopo il collaudo di SYNC-3b2 | Niente equip o trasferimenti Bungie |
| — | **MF-B1d** — Manifest italiano | ⏸ separata, in attesa | Non mescolarla con le fasi SYNC o Engine |

---

## 6. Backlog e visione (💡 non autorizzati)

- Verifica completa dell'installabilità di 5 armature (energia/costi, tier/masterwork, sblocchi, proprietà effettiva).
- Acquisition Planner, progressione del Potere, lore.
- Portale/enciclopedia Destiny per nuovi giocatori. Prima di integrare dati di terze parti, valutare termini d'uso, licenze e qualità delle fonti.

---

## 7. Divieti sempre validi

- Nessuna scrittura Bungie (equip/transfer) dall'Optimizer.
- Nessuna chiamata OpenAI a pagamento senza approvazione.
- Nessuna nuova dipendenza npm senza approvazione.
- Nessun token, account ID, Guardian ID o itemInstanceId in log, report, export o contesto AI.
- `unknown` non diventa `passed`, `0` o `locked`.
- Un dato in cache non è una verifica live di Bungie.
- Non modificare l'autenticazione Bungie senza approvazione.

---

## 8. Suite di regressione

```powershell
npx tsc --noEmit
npx tsx test-shared-item-detail-cache.ts
npx tsx test-item-detail-smart-refresh.ts
npx tsx test-item-detail-full-snapshot-regression.ts
npx tsx test-item-detail-client-sync.ts
npx tsx test-item-detail-profile-bridge.ts
npx tsx test-item-detail-sync.ts
npx tsx test-item-detail-store.ts
npx tsx test-armor-combination-engine.ts
npx tsx test-armor-combination-ui-bridge.ts
npx tsx test-armor-equipped-snapshot.ts
npx tsx test-armor-installability-validator.ts
```

Dichiarare superati solo i test effettivamente eseguiti, indicando chi li ha eseguiti e quando.