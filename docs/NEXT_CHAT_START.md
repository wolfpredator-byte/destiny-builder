# DESTINY BUILDER — AVVIO RAPIDO NUOVA CHAT

**Snapshot:** 20 ottobre 2026 · Handoff **v1.8** · checkpoint **dopo SYNC-3b1**  
**Documento completo:** `docs/DESTINY_BUILDER_PROJECT_MEMORY.md` (v1.8, **sezioni 0 e 23–26** prevalenti per stato operativo).  
**Perimetro:** Destiny Builder, **non** Jarvis/Ghost. **La `ROADMAP.md` effettiva del repository resta fonte di verità**; non è stata allegata a questo checkpoint.

## Messaggio pronto da incollare in una nuova chat

> Continuiamo **Destiny Builder** (Windows 11, Next.js 16.3.8 / React 19 / TypeScript, Node 24; `C:\Projects\DestinyBuilder\destiny-builder`). Ho allegato entrambi i file handoff **v1.8, 20/10/2026**. Leggi la **sezione 0 e le sezioni 23–26** del documento lungo, poi `AGENTS.md`, eventuale roadmap canonica e sorgenti realmente installati. **Non ricominciare dal vecchio B0.5c3b:** Engine B0.6a1/a2/a3 e SYNC-1→3b1 sono già stati sviluppati e testati, con conferme utente. **Ultimo checkpoint: SYNC-3b1 — lettura condivisa SQLite cache-first fra Builder, Vault/Inspector/Compare Tray — utente ha confermato «funziona tutto».** PROSSIMO: **SYNC-3b2, coordinatore automatico unico a livello app**, **non ancora implementato**. Prima di preparare patch chiedi/leggi le versioni correnti di `AppShell.tsx`, `src/app/layout.tsx`, `assistant-v2/page.tsx`, `itemDetailClientSync.ts`. Evita di ricaricare dettagli al cambio pagina; mantieni cache persistente, privacy, status e avanzamento, stop e limiti di richieste. Una patch mirata/file alla volta, test locali e collaudo Windows; **non** modificare transfer Vault, Builder Preview, legacy `armorOptimizer.ts` o installabilità, né eseguire scritture Bungie/chiamate OpenAI a pagamento. Dopo SYNC-3b2 si torna a **Engine-B0.6a4 — Apply to Builder Preview locale su conferma**. Parla in italiano, sintetico e concreto.

## Stato confermato e cosa NON è più da fare

| Checkpoint | Stato / prova riportata |
|---|---|
| B0.5c3e — Validator installabilità conservativa | **65/65 test PASS Windows** + TypeScript; `overallInstallable:false`, `certifiedForOptimization:false` |
| B0.6a1 — Combination Engine | **25/25 PASS Windows**; 5 slot, sei Min/Max reali, dati riconciliati, budget |
| B0.6a2 — UI Bridge | **15/15 PASS Windows** (+25 Engine = 40), risultati verificati in screenshot; legacy separato |
| B0.6a3 — Equipped Snapshot + batch manuali | **16/16 PASS Windows** (+15+25 = 56), 5 slot riconciliabili, progress/abort |
| SYNC-1 — `node:sqlite` persistente per account | **19/19 PASS Windows**; rollback, re-open, invalidazione e privacy |
| SYNC-2a — Coda incrementale | **19/19 PASS Windows**; 2 richieste concurrent, batch 32 |
| SYNC-2b — Route autenticata + cache read | **28/28 PASS Windows**; totale 66/66 SYNC e TypeScript PASS |
| SYNC-2c — Auto-hydration Armor v2 | **20/20 PASS Windows**; totale 86/86 SYNC e TypeScript PASS |
| SYNC-2c Hotfix — invalidazione falso snapshot | **8/8 regressioni e 94/94 totali offline**; in browser utente cache **457**, nuovi **0**, rimanenti **0**, armature equipaggiate **5/5** |
| SYNC-3a — Smart refresh | **19/19 e 113/113 totali offline**, utente: «funziona»; non presente log Windows test/tsc aggiornato in chat |
| **SYNC-3b1 — Shared cache-first Builder/Vault** | **18/18 offline** per adattatore, TSX parsing; utente: **«funziona tutto»**; non presente log CLI Windows aggiornato |

**Avvertenza sulle prove:** i test offline dell'assistente e quelli realmente incollati dall'utente da PowerShell non sono equivalenti. La conferma «funziona tutto» è prova d'uso browser, **non** la trascrizione di un `tsc`/test CLI. Non sommare suite eseguite in momenti diversi come una singola run.

## Architettura che NON va rifatta

- Manifest statico Bungie: cache versionata in `src/lib/bungie/manifest.ts`; il catalogo italiano/MF-B1d è una pista separata, non la cache degli oggetti posseduti.
- Dettagli privati degli item: SQLite `src/lib/destiny-builder/itemDetailStore.ts` (fuori da `public`, per account), sincronizzazione `itemDetailSync.ts`, `itemDetailClientSync.ts`, `itemDetailProfileBridge.ts`.
- `src/app/api/destiny/characters/[characterId]/inventory/route.ts`: `scope=core`, `scope=account`, `scope=detail`, `scope=cached-details` (batch autenticato). Solo dati server verificati autorizzano la scrittura su SQLite; no token salvati.
- `src/lib/destiny-builder/sharedItemDetailCache.ts`: dal 3b1 leggere in cache prima di chiamare Bungie per Builder `ensureItemDetail`, Vault Inspector e Compare Tray, con identità istanza/hash rigorosa. `scope=cached-details` è **cache**, non verifica live.
- Armor v2 `/guardian/[characterId]/assistant-v2`: B0.6 produce combinazioni **read-only** basate sui dettagli riconciliati; non equipaggia né trasferisce. `armorOptimizer.ts` legacy non modificato. `certifiedForOptimization:false` per vincoli non verificati.
- Politica SYNC-3a: nuovi item a priorità elevata; ricontrollo indicativo equipaggiati ~6 ore, altri ~3 giorni, limite di utilizzo ~30 giorni; max 8 ricontrolli periodici all'apertura, concorrenza 2. Il fingerprint non prova ogni possibile modifica del gioco.

## Prossima azione: SYNC-3b2 (NON IMPLEMENTATO)

**Richiedere/verificare le versioni *attuali* di:**

1. `src/components/destiny-builder/AppShell.tsx`
2. `src/app/layout.tsx`
3. `src/app/guardian/[characterId]/assistant-v2/page.tsx`
4. `src/lib/destiny-builder/itemDetailClientSync.ts`

Prima: confrontare con `AGENTS.md` (Next.js 16 breaking changes: leggere `node_modules/next/dist/docs/`), `ROADMAP.md` se esiste, e con `sharedItemDetailCache.ts` se necessario. **Non progettare un provider globale a memoria senza verificare i componenti di layout e i confini di autenticazione**. Prevedere single-flight per account, remount/navigazione, cambio Guardian, progress, abort, budget/rate limit e fallimento cache senza fetch storm. Nessuna automazione doppia insieme alla sync Armor v2.

**Test utili per regressioni** (eseguirli nel repo, non dichiararli passati in anticipo):

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

**Dopo SYNC-3b2:** `Engine-B0.6a4` per applicare una combinazione **solo alla Builder Preview locale con consenso esplicito**, lasciando la possibilità di trasferimento/equip reale nei suoi flussi separati e non automatici. `MF-B1d` resta sospesa, non introdurre lore/acquisition/power nelle fasi in corso.

**Come conservare questo checkpoint:** copia **entrambi i file** in `C:\Projects\DestinyBuilder\destiny-builder\docs\`, dopo aver confrontato/backup eventuali versioni esistenti. Sono file scaricati dalla chat: **non modificano automaticamente il repository, la roadmap, Git o il database SQLite**. Non allegare `.env.local`, token, account ID, Guardian ID o itemInstanceId.
