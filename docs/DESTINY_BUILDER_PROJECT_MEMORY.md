# DESTINY BUILDER — MEMORIA DEL PROGETTO, ROADMAP E REGISTRO DECISIONI

> **Versione:** 1.8 — 20 ottobre 2026 (checkpoint dopo SYNC-3b1)  
> **Ambito:** Destiny Builder / Destiny Build Assistant (non JARVIS/Ghost)  
> **Scopo:** documento di continuità da conservare nel repository e riutilizzare nelle nuove chat con ChatGPT e nei task Devin.  
> **Stato del documento:** ricostruzione basata su conversazioni, resoconti, codice e test condivisi. **Non è un audit completo del repository corrente**. Prima di cambiare codice, verificare i file reali sul PC.  
> **Collocazione suggerita:** `docs/DESTINY_BUILDER_PROJECT_MEMORY.md`.

---

## 0. LEGGERE QUESTO PRIMA DI LAVORARE — STATO ATTUALE v1.8

**Ultimo checkpoint operativo (20/10/2026): `SYNC-3b1 — lettura dettagli condivisa cache-first` confermato funzionante dall'utente nel Builder, Vault e Inspector.** La patch introduce `sharedItemDetailCache.ts` e la lettura `scope=cached-details` prima del fallback `scope=detail` per singole istanze. I **18/18 controlli di SYNC-3b1** sono stati riportati come superati offline dall'assistente (con parsing TSX delle pagine); l'utente ha confermato «funziona tutto» nella propria installazione. **Non è stato incollato un nuovo log `npx tsc --noEmit` o della suite SYNC-3b1 eseguita su Windows**. Non trasformare la conferma funzionale in un'affermazione di test CLI non mostrati.

**Ultimo checkpoint di sincronizzazione incrementale:** `SYNC-3a — smart refresh` confermato dall'utente con «funziona»; 19/19 nuovi test e 113/113 test combinati riportati **offline** dall'assistente. Si usa cache SQLite persistente per account, riutilizzo dei dettagli, acquisizione incrementale e ricontrolli limitati: oggetti equipaggiati dopo ~6 ore, altri posseduti dopo ~3 giorni, cutoff di utilizzo a ~30 giorni; massimo 8 ricontrolli periodici per apertura con concorrenza 2. Cambi osservati nei componenti richiedono aggiornamento; il semplice spostamento Guardian↔Vault non invalida il dettaglio. Cache ≠ conferma Bungie live.

**Conferme dirette dei test Windows:** SYNC-1 **19/19**, SYNC-2a **19/19**, SYNC-2b **28/28** (totale 66/66 e TypeScript PASS), SYNC-2c **20/20** (insieme alle precedenti 86/86 e TypeScript PASS). Hotfix `SYNC-2c` correggeva la falsa scomparsa/ricomparsa durante snapshot completi; 8/8 nuove regressioni + 86 precedenti = **94/94 offline**. La verifica UI reale dopo hotfix mostra **457 dettagli dalla cache, 0 download nuovi, 0 rimanenti; 5/5 armature equipaggiate riconciliate**. Non sommare esecuzioni offline e Windows come se fossero lo stesso run.

**Armor Engine verificato (18/10):** B0.5c3e Validator **65/65 PASS** su Windows; B0.6a1 ricerca locale **25/25 PASS**, B0.6a2 UI Bridge **15/15 PASS**, B0.6a3 riepilogo/coda **16/16 PASS** su Windows insieme a `npx tsc --noEmit`. Motore B0.6 restituisce combinazioni 5 slot, sei Min/Max reali, esotiche, pin/trasferimenti segnalati, mod e tuning già installati senza riscriverli; **non** certifica installabilità finale. `armorOptimizer.ts` legacy invariato. In screenshot B0.6a2 erano mostrate 5 combinazioni, su 24 candidati idonei e 77 combinazioni valutate.

**Prossimo checkpoint: `SYNC-3b2 — coordinatore di sincronizzazione a livello applicazione`, ANCORA NON implementato.** Evitare processi/fetch duplicati al passaggio tra pagine e coordinare sync, progress, stop, cache e Guardian attivo. **Prima di ogni patch leggere le versioni attuali** di `src/components/destiny-builder/AppShell.tsx`, `src/app/layout.tsx`, `src/app/guardian/[characterId]/assistant-v2/page.tsx` e `src/lib/destiny-builder/itemDetailClientSync.ts`; verificare anche il nuovo `sharedItemDetailCache.ts` se serve. Obbligatori `AGENTS.md` e documentazione locale `node_modules/next/dist/docs/` per modifiche Next.js. **Non inventare una roadmap:** la roadmap del repository, se presente, resta fonte di verità e non è stata condivisa come file autonomo in questo checkpoint.

**Dopo SYNC-3b2 e suo collaudo:** tornare a `Engine-B0.6a4 — applicazione esplicita alla sola Builder Preview locale`, non equip Bungie. `MF-B1d` sul Manifest italiano e progetti di lore/acquisition/power sono fasi separate. Nessuna chiamata OpenAI a pagamento o scrittura Bungie; niente refactoring massivo, né esposizione in log/report di token e ID privati.

**Nota sui capitoli storici:** le sezioni **1–22** sono conservate per audit/decisioni; le istruzioni «prossimo task B0.5c3b» e «non avviare B0.6» delle sezioni 21–22 sono **superate** dalle sezioni 23–26 e dal presente blocco. Non ripetere checkpoint già chiusi salvo regressioni documentate.

### Legenda dello stato

| Simbolo | Significato |
|---|---|
| ✅ | Realizzato e almeno in parte confermato dall'utente o da test riportati |
| 🟡 | Implementato, ma con limitazioni, verifiche mancanti o comportamento ancora bloccato |
| ▶ | Task corrente / prossimo controllo |
| ⏳ | Pianificato ma non implementato |
| 💡 | Visione futura, **non** autorizzazione a programmarla |

---

## 1. VISIONE E PERIMETRO

### Obiettivo attuale (MVP evoluto)

Un'applicazione web Destiny 2 che collega l'account Bungie, legge Guardian, equipaggiamento, inventari e Vault, analizza le **meccaniche reali** e **ottimizza le build a partire da ciò che il giocatore possiede o ha effettivamente sbloccato**. Per il nuovo motore armor: **nessuna scrittura Bungie**, simulazioni e *Builder Preview* locale soltanto. Le precedenti operazioni di trasferimento Vault ↔ Guardian esistono come funzione distinta, esplicita e opt-in; NON autorizzano l'Optimizer ad equipaggiare, trasferire o modificare oggetti.

- Non limitarsi a confrontare keyword dei perk o a un motore centrato sulle armi.
- Rispettare classe, sottoclasse, Super, granate, melee, abilità di classe, movimento, aspetti, frammenti, perk/roll, armature esotiche, Armor 3.0, mod, Armor Charge, set, Artifact, attività e condizioni/loop di gioco, **nella misura in cui i dati sono verificabili**.
- Supportare **Titan, Hunter, Warlock** e **Arc, Solar, Void, Stasis, Strand, Prismatic**; Voidwalker è un test, non un caso speciale architetturale.
- Una proposta suggerita dall'AI **non è una build certificata**: i controlli locali deterministici restano obbligatori e possono bloccarla.

### Visione futura (non per il prossimo sprint)

Un portale/enciclopedia interattiva unica per Destiny, utile anche alle nuove luci (*Blueberries*): unire in modo originale funzionalità ispirate a DIM, light.gg, Blueberry.gg, Destiny Optimizer e archivi della lore/libri (il nome di un archivio citato dall'utente era «Star Collective», da riconfermare se serve). Potrà comprendere come ottenere oggetti, guide alle attività, progressione di Potere, ricerca nel catalogo, storie e spiegazioni. Valutare fonti aggiornate, termini d'uso/licenze e qualità delle informazioni prima di integrare dati di terze parti.

**Decisione vincolante:** questa ambizione futura NON sostituisce l'attuale priorità di ottimizzazione dell'equipaggiamento posseduto.

---

## 2. REGOLE NON NEGOZIABILI DEL PROGETTO

1. **La roadmap concordata è la fonte di verità.** Una nuova idea va al backlog futuro; può interrompere la fase attiva solo se bug, regressione, sicurezza o dipendenza bloccante. Se esiste già una roadmap nel repository, confrontarla con questo documento prima di dichiararne una copia «canonica».
2. **Una modifica controllata per volta**, preferibilmente un file per task; evitare refactoring ampi senza necessità.
3. Prima di modificare un file, **leggere la sua versione attuale**, controllare `AGENTS.md`, i tipi e le dipendenze reali. Non supporre che un file condiviso in chat sia ancora la versione installata.
4. Dopo ogni modifica: `npx tsc --noEmit`, test locali mirati e, dove pertinenti, verifica nella UI/browser sul PC. **Indicare sempre quali test sono realmente stati eseguiti** e da chi.
5. UI/UX obbligatoria a ogni macrofase dati; niente prodotto fatto di solo JSON/debug, muri di testo o prompt. **Leggibilità** è la priorità di design approvata.
6. Non inventare proprietà del gioco, oggetti posseduti, statistiche, sblocchi, rotazioni, efficacia, danni o relazioni meccaniche. `unknown` non significa `locked`, `unowned` o zero.
7. Non effettuare scritture Bungie dall’Armor Optimizer/Simulator, né equipaggiamenti né trasferimenti; preview locale soltanto, preferibilmente con review e conferma esplicita. La funzione **separata** di transfer Vault ↔ Guardian, già verificata in passato con consenso, non fa parte di questi sprint.
8. Non chiamare automaticamente API OpenAI o Bungie per test o diagnosi. Le chiamate OpenAI sono potenzialmente a pagamento; **un solo test reale per checkpoint dopo verifiche locali**.
9. Privacy e sicurezza: non condividere `.env.local`, token OAuth, chiavi API, ID di istanza/account/Guardian nel pacchetto AI o nei log diagnostici. I riferimenti privati rimangono nel browser.
10. Evitare lunghe fasi teoriche; preferire sprint brevi e concreti **senza rinunciare a correttezza e test**.
11. ChatGPT: analisi/roadmap/revisione. Devin Desktop: implementazione delimitata. Utente: approva modifiche e verifica UI su Windows. Usare preferibilmente modalità/editor gratuiti per patch piccole, evitando sprechi di quota Devin.
12. Separare sempre **equipaggiato su Bungie**, **Builder Preview locale**, **posseduto** e **catalogo di oggetti possibili**.

---

## 3. AMBIENTE E ARCHITETTURA

| Componente | Dato noto |
|---|---|
| Sistema | Windows 11 |
| Editor | **Devin Desktop Free** (in precedenza VS Code), con editing diretto e terminale PowerShell |
| Workspace | `C:\Projects\DestinyBuilder\destiny-builder` — confermato da `Get-Location` il 12/10/2026 |
| Framework | Next.js App Router + React + TypeScript + Tailwind CSS |
| Runtime | Node.js 24.x (in precedenza v24.20.0), npm 11.x; verificare versione attuale se serve |
| Esecuzione locale | HTTPS `https://localhost:3000` nell'ultimo test, attenzione a URL OAuth coerenti |
| Account | OAuth Bungie, login/refresh/status, snapshot Guardian/inventario e Vault |
| AI | API OpenAI server-side con modello economico configurato in `src/app/api/destiny/assistant/ai/route.ts`; nome/modello/prezzi verificare nel file e nel provider attuali |

### Pagine e principali file noti

- `src/app/page.tsx` — landing/login; i link obsoleti `/api/auth/login` sono stati sostituiti con `/api/auth/bungie` nell'ottobre 2026.
- `src/app/api/auth/bungie/route.ts`, `src/app/api/auth/callback/bungie/route.ts`, `src/app/api/auth/refresh/route.ts`, `src/app/api/auth/status/route.ts`.
- `src/app/guardian/[characterId]/assistant/page.tsx` — Build Assistant, attualmente file molto grande (~3.800+ righe nel file condiviso); UI, generazione, controllo ipotesi, reconciler esotiche e preview.
- `src/lib/destiny-builder/buildContext.ts` — snapshot e Builder Draft.
- `src/lib/destiny-builder/universalPlanningContext.ts` — visione trasversale e verificabile di gear, sottoclassi, Artifact, coverage.
- `src/lib/destiny-builder/armorOptimizer.ts` — combinazioni armature possedute.
- `src/lib/destiny-builder/fullBuildPlanner.ts` — generazione e validazione locale di proposte complete.
- `src/lib/destiny-builder/aiContextBudget.ts` — pacchetto AI compatto; **mai trasmettere `privateItemRefs`**.
- `src/lib/destiny-builder/mechanicsResolver.ts` — meccaniche/trigger/effects/catene osservate.
- `src/lib/destiny-builder/compatibilityValidator.ts`, `recommendationEngine.ts`, `synergyEngine.ts`.
- `src/app/api/destiny/assistant/ai/route.ts` — AI context hypotheses/intent-only, validazione delle risposte e rate guard solo development.
- `src/app/api/destiny/characters/[characterId]/inventory/route.ts` — snapshot `scope=core`, `scope=account`, `scope=detail`.
- Altre route note: `destiny/characters`, `destiny/memberships`, `destiny/profile`, `destiny/vault`, `destiny/item/[itemHash]`, `destiny/transfer`.

### Flusso logico esistente

`Bungie API/Manifest -> BuildContext e dettagli verificati -> UniversalPlanningContext -> engine deterministici -> Builder Preview (solo su conferma)`.

Per l'AI: `richiesta -> aiContextBudget.packet` (sottoinsieme ≤ 18.000 caratteri JSON, ≤ 26 oggetti) `-> route server OpenAI -> ipotesi non fidate -> controlli su packet + live context + fullBuildPlanner -> esito strutturale (valid/partial/blocked), MAI equipaggiamento automatico`.

Il catalogo Bungie **statico** è diverso dalle statistiche/roll dello specifico oggetto posseduto, dalla disponibilità live dei vendor e dagli sblocchi individuali.

---

## 4. CRONOLOGIA / LAVORO SVOLTO

### Fasi fondamentali, 0–7 (✅ con punti da verificare in caso di regressione)

- Scaffold Next.js/TypeScript, integrazione Bungie OAuth; login, membership e scelta Guardian (Titan/Hunter/Warlock).
- Inventory & Equipment, Vault e oggetti degli altri Guardian; bug iniziali con dati vuoti e Vault risolti.
- Manifest già utilizzato per risolvere almeno nomi/definizioni/hash di plug e oggetti; **non assumere che sia già un database locale completo e indicizzato**.
- UI per equipaggiamento, sottoclassi e abilità; stati selezionato/sbloccato/bloccato/non noto e gestione di opzioni socket.
- Sottoclassi Arc, Solar, Void, Stasis, Strand, Prismatic e disponibilità diversa per Guardian: Warlock nuovo con alcuni elementi ancora non sbloccati.
- Loadouts/Builder Preview separata dall'equipaggiamento reale; Vault e other-Guardian inclusi nella ricerca; Artifact reale e perk; comparazione di perk/armature.
- Caricamenti inizialmente lenti: poi migliorati con progressi e indicatori per dati account e background. «Sync Bungie» e session refresh in uso.
- Richieste UI storiche: perk armi ben visibili, confronti completi, possibilità di riselezionare l'equipaggiato, evitare frammenti/aspetti duplicati. Alcune correzioni già fatte, ma non assumere che tutte siano coperte universalmente.

### 8R.1 — Stat Coverage Audit (✅)

Campioni reali: Nothing Manacles (Scatter Charge), Eutechnology Gloves (stat Armor 3.0 e set), Mint Retrograde (perk/stats). Conclusione: `scope=core` non equivale a `scope=detail`; `0` osservato ≠ valore sconosciuto.

### 8R.2 / 8R.5 — Mechanics Resolver e ampliamento strutturato (🟡)

Resolver iniziale con Scatter Charge, Firepower, Feed the Void, Echo of Starvation, Chain Reaction, Beacon Rounds e catena condizionale `Firepower → Orb of Power → Echo of Starvation → Devour`; falso positivo «Volatile Launch» escluso. Successivamente introdotti requisiti più strutturati, provenance/certura UI, espansione Voidwalker e verifiche su Nothing Manacles + Chaos Accelerant. **Catalogo ancora incompleto**: niente affermazioni universali di efficacia o sinergia senza prova.

### 8R.3 / 8R.3.4 — Raccomandazioni, compatibilità e Armor 3.0 (✅/🟡)

Confronto meccaniche prima/dopo, limiti di classe/slot/esotiche, set bonus e copertura dati. Sei stat Armor 3.0: `Weapons, Health, Class, Grenade, Super, Melee`; confronto before/after calcolato sui cinque pezzi. Distinguere totale armature e vera statistica finale del Guardian.

### 8R.4 / 8R.4.4 — Armor Optimizer + stabilità/UX (✅)

- Ricerca combinazioni di 5 armature realmente possedute (Guardian, Vault, altri personaggi), fino a 5 proposte; pesi e minimi, pezzi bloccati, esotica, vincoli set e perdita statistica, loss aversion, meccaniche e catene selezionate, before/after.
- Test utente: cinque configurazioni distinte preservando Nothing Manacles; una configurazione con 150 Grenade e 39 Health applicata alla sola Builder Preview e visualizzata nella pagina Build.
- 8R.4.4 A1 bug focus/remount stato UI corretto; A2c cache di dettagli ARMOR compatta nella sessione, riconciliata con snapshot, senza persistere token.
- B1 fetch progressivo dettagli selezionati; B2 caricamento Armor Optimizer a batch, con massimo 32 richieste per avvio, batch da 8, concorrenza 2, Stop/feedback. Test utente confermati.
- Se UI legacy mostra troppo testo, è un debito UX da affrontare in UI v2, non ragione per rimuovere il motore.

### 8R.6.1 / 8R.6.2 — Universal Planning & Full Build Planner (✅ con copertura parziale)

`universalPlanningContext.ts` ricompone dati osservati trasversali; `fullBuildPlanner.ts` genera starting points e valuta proposte, rispettando classe, elementi, duplicati, gear e copertura. UI Generate Candidates eseguita e confermata senza regressioni. Il planner **non certifica performance PvE/PvP**.

### 8R.6.3 — AI Cloud bounded hypotheses (✅ parziale / 🟡)

- `aiContextBudget.ts`: invio di soli dati pertinenti, limitati a circa 26 pezzi / 18k caratteri; ID privati in mappa locale; patch C5B migliora dati della sottoclasse richiesta. La selezione resta un **sottoinsieme** e non dimostra l'assenza di alternative.
- C5A1 risolto crash di stato legacy durante Fast Refresh.
- C5A2 «Same-Slot Reconciliation»: selezionato + sostituto verificabile nello stesso slot può essere interpretato come swap; alternative ambigue bloccate. Nel flusso esistono anche controlli di legalità delle esotiche.
- Ottobre 12: errore login dovuto a link frontend inesistente `/api/auth/login`; route corretta `/api/auth/bungie`. Login ripristinato; Generate Candidates e Armor Optimizer testati.
- C5C1: `socketChoices` opzionali nelle ipotesi AI (Super, granata, melee, aspetti, frammenti ecc.); validazione contro packet e contesto live; rifiuto `possible_unverified` corretto. `npx tsc --noEmit` confermato dall'utente.
- C5C2/C5C2a: route server aggiornata per proporre socket choices con JSON Schema strict e verificarle. Compilazione confermata.
- C5D1: diagnostica dell'errore AI; test reale ha restituito `context_validation_failed`.
- C5D2: gestione prudente delle ipotesi parzialmente non verificabili; compilazione confermata e successivo test AI **ha prodotto una proposta strutturata Voidwalker** (sottoclasse, abilità, frammenti, esotica). **È stata correttamente BLOCCATA**, non approvata come build valida.

#### Snapshot del test reale C5D2 (utile per debugging, NON sempre attuale)

- Warlock equipaggiato con **Stormcaller**, richiesta build PvE **Voidwalker** con granate/Devour/sopravvivenza.
- Risultato AI: Super Nova Bomb: Cataclysm, granata Vortex, melee Pocket Singularity, Healing Rift, aspetti Chaos Accelerant + Feed the Void, vari frammenti; esotica proposta **Contraverse Hold**.
- Crown of Tempests risultava la seconda esotica sulla build selezionata. Il reconciler cercava di rimpiazzarla con un elmo **non esotico e verificato**, senza trovarne uno che soddisfacesse tutti i criteri. Esito visualizzato: `BLOCKED`.
- Snapshot: circa 26 item nel packet e 280 item omessi. **Non** dedurre che l'utente non possieda elmi sostitutivi: potrebbe mancare la verifica dei dettagli/rarità/posizione.
- La checkbox **Keep selected exotic armor** gestisce *Generate Candidates* e la generazione «Text only» successiva; nel file `page.tsx` revisionato non viene passata direttamente a `reconcileAiArmorExotics` per *Analyze my gear with AI*. Non attribuire a questa checkbox il blocco del test sopra.
- Il test prova che la catena AI ha prodotto una proposta e che i controlli hanno bloccato una configurazione illegale/incompleta. **Non** prova efficacia, legalità finale o compatibilità universale delle 11 ability choices con tutte le restrizioni di Destiny.

---

## 5. CHECKPOINT CONCLUSO NEL BROWSER — 8R.6.3C5E1 → C5E1c

**Obiettivo:** diagnosticare il BLOCKED quando l'AI propone Contraverse Hold mentre Crown of Tempests resta selezionata; verificare l'esistenza di elmi non esotici posseduti e, se occorre, recuperare soltanto i dettagli delle istanze pertinenti.

### Evoluzione dei task (12 ottobre 2026)

| Fase | Azione | Risultato e livello di evidenza |
|---|---|---|
| `C5E1` | Aggiunta `exoticReplacementDiagnostics` e pannello locale read-only in `src/app/guardian/[characterId]/assistant/page.tsx` | Devin: test sintetici; browser: 25 alternative elmo, 0 dettagli, ma inclusione indebita di pezzi leggendari e conteggi indipendenti |
| `C5E1a` | Solo esotiche con `armorMetadata?.exotic === true`; filtri progressivi ed esclusioni indipendenti | Browser: Crown of Tempests unica esotica da diagnosticare; 25 alternative → 6 eleggibili → 4 non esotiche → 0 dettagli |
| `C5E1b` | Audit senza modifica del percorso cache/dettagli `page.tsx` → `buildContext.ts` → `universalPlanningContext.ts` | Devin: recupero selettivo dei dettagli; caricamento alternative non garantito perché non sempre selezionate/candidate all'optimizer |
| `C5E1c` | Pulsante manuale `Load Missing Replacement Details`, massimo 4 per clic, cache e API già esistenti, controlli istanza/hash e cambi Guardian | **Screenshot reale:** 25 → 25 identificabili → 25 non usati → 6 candidate → 6 posizione confermata → 4 non esotiche → **4 dettagli verified → 4 fully qualified** |

### Criteri reali del reconciler (non indeboliti)

Sono richiesti insieme: `category === "armor"`, `slotHash` corrispondente, `itemInstanceId` reale e non già in uso, `eligibility === "candidate"`, `positionStatus === "confirmed"`, `armorMetadata?.exotic === false`, `detailCoverage === "verified"`.

**Risultato dimostrato:** esistono **4 elmi** del Warlock idonei secondo i filtri diagnostici nel contesto del browser dopo il fetch mirato. Il problema iniziale era la mancanza di dettagli verificati per le alternative, non l'assenza di tutti gli elmi.

**Non ancora dimostrato:** che il reconciler effettivamente scelga e applichi uno dei quattro quando una specifica ipotesi AI contiene Contraverse Hold, né che l'intera build risultante sia validata. Non spendere in chiamate AI per verificare qualcosa che può essere testato localmente; eventuale test deterministico separato.

**TypeScript C5E1c:** il 12/10/2026 l’utente conferma esplicitamente che `npx tsc --noEmit` passa dopo l’ultima modifica. Devin ha dichiarato 5 test sintetici, ma non test browser per errore fetch o cambio Guardian; non è ancora confermata la sopravvivenza dei dettagli dopo un reload. Questi sono controlli residui non bloccanti per iniziare l’audit Manifest.

**File modificato nelle fasi C5E1/a/c:** `src/app/guardian/[characterId]/assistant/page.tsx`. `C5E1b` analisi senza edit. Nessun nuovo sistema cache o modifica ai validator/Bungie equip.

---

## 6. CHECKPOINT STORICO AL 12/10 — MANIFEST FOUNDATION (non è il prossimo task attuale)

**Stato:** ⏳ studio tecnico e design; NON implementato come nuovo database completo.

**Prossimo task operativo — MF-A / Audit read-only:** far ispezionare a Devin i punti di lettura/richiamo del Manifest già esistenti, la provenienza di nomi/icone/definizioni, cache persistente ed eventuali endpoint e versioni. Nessuna modifica al codice e nessun download massivo finché non sono noti i file e i contratti attuali. Output: mappa file/funzioni, quali definizioni sono statiche vs dati personali per istanza, gap, rischi, proposta minima per un catalogo locale indicizzato con aggiornamento per versione e prestazioni misurabili. In parallelo progettare soltanto il wireframe UI v2; nessuna riscrittura della pagina assistente in questo task.


Obiettivo: scaricare/utilizzare il **Destiny Manifest** di Bungie (definizioni statiche, eventuali DB SQLite/JSON localizzati) come catalogo indicizzato e aggiornabile per nomi, icone, tipi, plug, esotiche, abilità e, in futuro, attività e vendor. Prima verificare **come il progetto usa già il Manifest** (nomi e plug esistenti) ed evitare duplicazione/rottura.

Separare tre domini:

1. **Manifest statico:** descrive oggetti e possibili opzioni; non prova possesso o roll reale.
2. **Bungie account/live:** Guardian, istanze, roll/statistiche effettive, slot, equipaggiato, sbloccato, Collezioni; richiede autenticazione/sync e cache con invalidazione.
3. **Acquisition/live rewards:** vendor e ricompense con rotazioni o fonti non garantite; richiede ulteriore evidenza aggiornata, da affrontare dopo.

Checklist dello sprint: individuare endpoint/versione già usati, valutare dimensione IT, SQLite vs JSON, politica update/versioning, server-side index, ricerca per hash/nome, icone remote lazy-loaded, fallback offline/errore e performance. Inviare al client solo ciò che serve per la schermata, **non tutto il Manifest per pagina**. Non inviare il Manifest completo all'AI: fare retrieval mirato e context budget.

**Criterio di uscita:** piano architetturale e misurazioni locali realistiche, eventualmente spike isolato; nessuna promessa infondata di performance. La completa implementazione necessita approvazione roadmap.

---

## 7. UI V2 — DESIGN APPROVATO (PROGETTAZIONE PARALLELA)

**Parola chiave obbligatoria: LEGGIBILITÀ.** UI attuale ritenuta troppo densa di scritte, prompt e debug; migliorarla senza perdere funzionalità.

### Home Build Assistant

1. **In alto: snapshot dell'equipaggiamento EFFETTIVAMENTE su Bungie, rigorosamente sola lettura** (non confondere con la Builder Preview). Nome Guardian, sottoclasse, armi, 5 armature, abilità, aspetti/frammenti, Artifact, informazioni e icone reali dove disponibili.
2. **Sotto: quattro moduli visivamente distinti**, ognuno con propri filtri/controlli e AI opzionale quando serve: **Armature**, **Armi**, **Abilità/Sottoclasse**, **Artefatto**.
3. Se il giocatore apre «Ottimizza armature», le altre scelte devono rimanere bloccate/invariate per impostazione predefinita. Stesso principio per gli altri moduli.
4. **Full Build Assistant AI in pagina separata** o navigazione chiaramente distinta dalla modifica mirata. Qui l'utente sa di richiedere una proposta globale, sempre in preview e validata.
5. **Prima immagini e gerarchia visiva, poi dettagli:** icone Bungie, nomi visibili, filtri intuitivi, gruppi di perk/stats, messaggi sintetici, esito disponibili/locked/unknown con etichette e non solo colori, dettagli tecnici espandibili, confronto «prima vs dopo» e motivi di blocco.
6. Niente quattro caselle prompt uguali: **Armature** con stile DIM (priorità/min/max/pesi, esotica, set, locked pieces); **Armi** con slot/tipo/perk/munizioni/ruolo; **Abilità** con Super/abilità/aspetti/frammenti/sinergie; **Artefatto** con perk stagionali e condizioni.
7. Il motore di Armature funziona soprattutto **senza AI**; usare algoritmi locali dove possibile, AI facoltativa per obiettivi in linguaggio naturale e spiegazioni. Anche per armi/ability/Artifact preferire fatti/meccaniche e validatori locali.
8. Design/prototipo in parallelo allo studio Manifest; sviluppo incrementale con test e UI checkpoint, **non big-bang rewrite**.

### Vincoli di architettura

Condividere `UniversalPlanningContext` e `FullBuildPlanner`/validator; separare motori/pannelli, non la verità sul Guardian. Una modifica in un modulo deve essere validata nel contesto intero quando necessario (stat di frammenti, una sola esotica, set bonus ecc.).

**Stato:** struttura UX concordata; wireframe dettagliato e implementazione UI v2 **ancora da approvare e realizzare**.

---

## 8. IDEE FUTURE / BACKLOG (NON AVVIARE ORA)

| Area | Idea | Quando |
|---|---|---|
| Full Build AI | Consolidare pagina separata per generazione globale, con profili build, spiegazioni e verifiche | Dopo basi UI e dati, secondo roadmap |
| Acquisition Planner | Mostrare oggetti mancanti e fonti attendibili; venditori, raid, dungeon, missioni, restrizioni/rotazioni | Futuro |
| Power Progression | Guida ai miglioramenti del Potere/Light con ricompense e limiti verificati | Futuro |
| Blueberry Guide | Percorsi per nuovi giocatori, spiegazioni di gameplay, priorità attività | Futuro |
| Destiny Encyclopedia | Ricerca globale armi, armature, abilità, mod, cosmetici, attività e vendor | Futuro |
| Lore Archive | Libri, storie e collegamenti verificati; rispettare diritti/fonti di terzi | Futuro |
| Activity History / PGCR | Confrontare build con attività realmente giocate senza inventare dati telemetrici assenti | Futuro |
| Storage/sync | Auto refresh token, offline, cache più robusta, fallback per timeout e per-sezione | Futuro |
| UI polish | Design system, accessibilità, responsive, rifiniture post-v1 | Parte della UI v2 e successivi |
| Equip API | Eventuale equipaggiamento effettivo con consenso e controlli sicurezza | Esplicitamente fuori scope attuale |

L'ispirazione a DIM, light.gg, Blueberry.gg e Destiny Optimizer riguarda le **categorie funzionali**, non una licenza a copiare contenuti o API di terzi senza verifica.

---

## 9. RISCHI E PROBLEMI APERTI

- `C5E1c`: problema dei dettagli non verificati **risolto per il test Warlock/Crown of Tempests** (4 candidati fully qualified); **`npx tsc --noEmit` confermato passato dall’utente**. Restano come verifiche non bloccanti persistenza dopo reload ed eventuale preflight locale senza nuova spesa AI.
- Catalogo meccaniche ancora incompleto; l'AI può suggerire combinazioni plausibili ma non provarne efficacia o tempo di attivazione.
- Compattazione AI: fino a 3 opzioni iniziali per socket in una fase del codebase; opzioni omesse non vanno confuse con bloccate. Verificare versione installata di `aiContextBudget.ts` e di `route.ts` prima di nuove patch.
- Validazione di duplicati frammenti/aspetti su socket multipli: test e limiti devono rimanere parte dei criteri di accettazione.
- UI assistente attuale troppo testuale/densa; snapshot read-only non deve usare erroneamente dati Preview.
- Rate limits/costi OpenAI: route con guard in memoria **non garantisce budget monetario** né sicurezza produzione; produzione volutamente disabilitata finché mancano autentica e limiti durevoli.
- OAuth locale: frontend deve usare `/api/auth/bungie`, non `/api/auth/login`; controllare HTTPS/redirect solo se errore specifico.
- Dati non più attuali dopo sync: validare sempre istanza, hash, posizione, classe e copertura contro snapshot aggiornato; non memorizzare secret.

---

## 10. WORKFLOW DI SVILUPPO / PROTOCOLLO CHATGPT + DEVIN

### Prima di un task

- Leggere questo documento e `AGENTS.md`, verificare la roadmap reale nel repo. Confermare fase attiva e file da toccare.
- Leggere il codice attuale. Non applicare patch di chat vecchie a file cambiati successivamente.
- Se è una nuova idea, inserirla in «Idee future» senza deviare.
- Definire criteri di accettazione **osservabili**, casi `unknown`, privacy, nessun pagamento automatico.

### Task Devin (template)

```text
Destiny Builder — [FASE] [TITOLO]
Roadmap e PROJECT_MEMORY sono fonte di riferimento; leggi AGENTS.md.
Obiettivo: [risultato verificabile].
Puoi MODIFICARE soltanto: [un file].
Puoi LEGGERE: [file strettamente necessari].
Non cambiare moduli funzionanti, Bungie writes, segreti, UI non richiesta.
Nessuna chiamata OpenAI/Bungie. Nessuna dipendenza extra.
Esegui npx tsc --noEmit + test locali mirati.
Consegna: file/diff, test realmente eseguiti, rischi e limitazioni.
Fermati; non procedere alla fase successiva senza approvazione.
```

### Dopo un task

- Confrontare diff e types. Eseguire `npx tsc --noEmit` dalla root `C:\Projects\DestinyBuilder\destiny-builder`.
- Verificare nel browser i flussi toccati. Separare test sintetici, parsing/TypeScript, test reale con Bungie e test API OpenAI a pagamento.
- Annotare nel changelog **data, fase, modifica, test, stato e successiva azione**. Aggiornare il file quick-handoff `NEXT_CHAT_START.md`.
- Idealmente committare i documenti insieme al codice nel repo Git, così restano versionati.

### Stile di interazione desiderato

Italiano, collaborativo, diretto, operativo, no lunghi capitoli teorici ripetitivi. Una modifica alla volta, UI comprensibile e nessuna falsa certezza.

---

## 11. REGISTRO DELLE DECISIONI (DECISION LOG)

| Data | Decisione | Conseguenza |
|---|---|---|
| 03/10/2026 e precedenti | Roadmap madre unica, nuove idee nel futuro, UI checkpoint e preview locale | Niente deviazioni arbitrarie |
| 10–11/10/2026 | Studio serio meccaniche, Armor 3.0 ed esotiche; assistente universale, non keyword Void-centric | Validator/evidence e prudenza su unknown |
| 12/10/2026 | Devin Desktop Free come editor/implementatore; ChatGPT revisione | Task piccoli e quota sotto controllo |
| 12/10/2026 | Login route corretta `/api/auth/bungie` | OAuth locale ripristinato |
| 12/10/2026 | AI socketChoices e JSON strict, patch successive C5D2 | Risposta AI con abilità, ma proposta Contraverse Hold BLOCKED per seconda esotica |
| 12/10/2026 | Prima diagnosticare esotiche C5E1; poi Manifest Foundation | Non smontare il validator per aggirare BLOCKED |
| 12/10/2026 | Nuova home read-only + quattro moduli, Full Build AI separato, UI leggibile | UI v2 design in parallelo, implementazione modulare |
| 12/10/2026 | Per ora soltanto ottimizzazione owned-build; enciclopedia/guide/Acquisition/Power/lore future | Nessun feature creep ora |
| 12/10/2026 | Documento di memoria del progetto aggiornabile fra chat | Leggere stato e roadmap prima di riprendere |
| 12/10/2026 | C5E1/a/b/c: audit e caricamento mirato dettagli alternative all'esotica | Browser: 4 elmi verificati su 4 candidati, 4 fully qualified; Manifest Foundation prossimo task |

---

## 12. CHIUSURA SPRINT / AGGIORNAMENTO DI QUESTO DOCUMENTO

Da compilare **dopo ogni fase**, prima di aprire una nuova chat:

```text
Data:
Fase completata (o parziale):
File modificati (percorsi esatti):
Comportamento verificato dall'utente nel browser:
Test TypeScript / unitari / sintetici (specificare):
Test REALI Bungie/OpenAI e costi (se eseguiti):
Problemi aperti o rischi:
Decisioni prese:
NEXT TASK — ID + file + obiettivo + accettazione:
```

### Ultimo aggiornamento — 12/10/2026 (v1.2)

- `C5E1` diagnostica e `C5E1a` progressione filtri verificate nel browser.
- `C5E1b` ha tracciato la cache locale e il caricamento selettivo. `C5E1c` ha aggiunto il fetch manuale limitato delle alternative via infrastruttura già esistente.
- **Browser reale dopo C5E1c:** Crown of Tempests, 25 alternative, 6 candidate, 4 non esotiche compatibili, **4 detail verified e 4 fully qualified**; prima erano zero.
- **TypeScript finale:** `npx tsc --noEmit` passato, confermato dall’utente dopo C5E1c. **Restano verifiche aggiuntive non bloccanti:** durata in cache oltre reload, eventuale preflight deterministico completo e comportamento con errori/cambio Guardian.
- **Prossimo lavoro:** `Manifest Foundation` (prima audit, non implementazione in massa); in parallelo wireframe UI v2 leggibile e modulare.
- Acquisition Planner, Power Progression, Blueberry Guide e lore restano backlog futuro.

---

## 13. REGOLE PER UNA NUOVA CHAT

1. Allegare **questo file** e `NEXT_CHAT_START.md` oppure incollare almeno il quick-handoff.
2. Specificare: «Continuiamo Destiny Builder, non ricominciare da zero. Verifica la fase corrente e chiedimi il file sorgente aggiornato prima di modificarlo».
3. Confrontare la cronologia di questo documento con i file del repository, soprattutto se sono passati giorni o Devin ha fatto altre modifiche.
4. A fine sessione aggiornare il registro, la fase corrente e il quick-handoff. **Nessuna chat da sola aggiorna automaticamente i file locali**.

**Fine — versione 1.2.**


---

## 14. MF-A — Manifest Foundation, audit read-only (12/10/2026 · v1.3)

**Stato:** audit concluso da Devin, basato su lettura dei file nel repository. Nessuna modifica al codice eseguita durante MF-A. Non confondere con una integrazione del Manifest completo già realizzata.

### Architettura osservata nell'audit

- `src/lib/bungie/manifest.ts`: `getManifestDefinition`, `getInventoryItemDefinition`, cache memoria per definizione (TTL indicato: 12 ore), cache su disco temporaneo `destiny-builder-manifest-cache/{definitionType}/{hash}.json`, fallback API Bungie per hash.
- `src/lib/bungie/stats.ts` e `src/lib/bungie/plugSets.ts`: accessor delle definizioni rispettive.
- `src/app/api/destiny/characters/[characterId]/inventory/route.ts`: consumatore pesante per Item, Stat, PlugSet, SandboxPerk, EquipableItemSet; cache addizionali in-process specifiche della route; altre route consumer: transfer/vault/item.
- Catalogo statico (nomi, descrizioni, icone, definizioni) separato da dati account/istanza (roll, statistiche reali, stato equipaggiato, sblocchi, posizione).
- L'audit segnala assenza di invalidazione centralizzata basata sulla revisione del Manifest, duplicazione di cache non coordinate e assenza di indice globale per nome/categoria.
- I tempi API/performance reali, le dimensioni del database e la causa di ogni colpo alla rete NON sono stati misurati in questo audit: non presentare i colli di bottiglia come benchmark dimostrati.

### Correzioni di progetto dopo review

1. `GetDestinyManifest` espone `Response.version` per identificare la revisione. `jsonWorldContentPaths.en` è un percorso di file, non il campo semantico primario «version»; il percorso può essere usato solo come fingerprint/fallback motivato.
2. Bungie distribuisce il Manifest già localizzato, incluso **italiano (`it`)**. Il limite dell'app attuale è l'utilizzo in inglese, non l'assenza di localizzazione Bungie. Nessuna traduzione comunitaria necessaria per i nomi ufficiali nel catalogo italiano.
3. Le cache memoria, disco e route non sono intrinsecamente sbagliate, ma vanno coordinate. Non cancellare dati account/istanze quando cambia il Manifest statico.
4. Non eseguire la chiamata «controlla versione» in rete per ogni lookup/hash: memoria con TTL e single-flight, gestione errori e fallback.
5. Il database SQLite è da valutare successivamente: FTS5 è per ricerca testuale, **non una tecnica di compressione**; il pacchetto `.content` Bungie è un archivio compresso dello snapshot SQLite. L'aggiornamento con nuova versione è normalmente uno snapshot nuovo, non un delta incrementale gratuito.

### Sequenza approvata per implementazione progressiva

- **MF-A1a — PIANO STORICO, ORA COMPLETATO:** intervenire soltanto su `src/lib/bungie/manifest.ts`; leggere il file reale prima di editare, integrare discovery `Response.version` con refresh limitato (~1h configurazione interna), single-flight, fallback sicuro se il controllo fallisce, cache statiche isolate per versione e protezione da race delle richieste vecchie. Non introdurre route/API pubblica, SQLite, dipendenze o fetch massivi. Eseguire TypeScript e test sintetici. Non dichiarare finita l'invalidazione complessiva prima di MF-A1b.
- **MF-A1b — PIANO STORICO, ORA COMPLETATO:** invalidare/versionare anche le cache in-process in `inventory/route.ts`, con modifica strettamente circoscritta e test.
- **Manifest locale completo (fase successiva separata):** valutare poi JSON/SQLite italiano versionato per l'indice/catalogo server-side, previo benchmark di dimensioni e prestazioni. Non presumere che sostituisca dettagli istanza Bungie.
- **UI v2 design in parallelo**, nessuna grande riscrittura ora. Acquisition Planner, Power Progression, Guide Blueberry e Lore ancora nel backlog futuro.

**Checkpoint storico v1.3:** MF-A audit finito, MF-A1a ancora pendente in quel momento. Al 12/10 MF-A1a e MF-A1b risultano completate; riferirsi alla sezione 16 per lo stato corrente.


---

## 15. MF-A1a — Cache Manifest versionata (12/10/2026 · v1.4)

**Stato: approvato con conferma dell'utente.** Devin ha inizialmente implementato `MF-A1a` in `src/lib/bungie/manifest.ts`, poi la code review ha evidenziato criticità in `force-cache`, doppio controllo versione con TTL, cleanup concorrente, fallback non verificato e gestione delle promesse. È stata consegnata una versione rivista di `manifest.ts`, installata dall'utente. **L'utente conferma che tutto passa**: TypeScript (`npx tsc --noEmit`) e browser Guardian/inventario. I test sintetici sulla revisione erano stati eseguiti in isolamento; non sono benchmark di produzione.

**Architettura della versione rivista verificata nel sorgente:**
- `GetDestinyManifest.Response.version` con validazione, TTL 1h, single-flight, retry breve dopo errore; fallback all'ultima versione conosciuta senza considerarla appena verificata.
- Chiavi/file versionati per `DestinyInventoryItemDefinition`, `DestinyStatDefinition` e `DestinyPlugSetDefinition`; cache memoria 12h + file locali, e risposte HTTP delle definizioni con `no-store`.
- Nessuna cancellazione immediata dei file delle vecchie revisioni; nessun caching di nuove definizioni sotto versioni non verificate.
- Nessuna modifica delle istanze private Bungie.

**MF-A1b — CHECKPOINT STORICO, ORA COMPLETATO:** analizzare e coordinare **solo** le cache route in `src/app/api/destiny/characters/[characterId]/inventory/route.ts`. Priorità: eliminare cache module-level indefinite di Promise, quando la cache versionata condivisa esiste già; per definizioni generiche (perk/set) usare almeno deduplicazione per richiesta e rete `no-store`, senza vecchie promesse tra richieste. Verificare prima i consumer attuali `stats.ts` e `plugSets.ts`; se il coordinamento richiede toccare `manifest.ts`, fermarsi e proporre una fase separata (una modifica per volta). Niente SQLite integrale, nuovo download Manifest, nuove API AI, cambiamenti a OAuth/inventario personale/validatori. Typecheck e test.

**Fasi successive:** esplorazione catalogo italiano del Manifest / dimensioni SQLite con benchmark, progettazione UI v2 leggibile in parallelo. Acquisition Planner, Power Progression e Lore restano future.


---

## 16. MF-A1b — Coordinamento cache inventario (12/10/2026 · v1.5)

**Stato: COMPLETATO — verifica funzionale confermata dall’utente dopo la revisione.** Devin ha modificato unicamente `src/app/api/destiny/characters/[characterId]/inventory/route.ts` eliminando quattro cache module-level di Promise non versionate: `inventoryDefinitionCache`, `statDefinitionCache`, `plugSetDefinitionCache`, `genericManifestDefinitionCache`. Le definizioni InventoryItem/Stat/PlugSet passano alle funzioni centrali già versionate in `manifest.ts`, usando i wrapper esistenti `stats.ts` e `plugSets.ts`. Le definizioni generiche (SandboxPerk, EquipableItemSet, Artifact e Loadout Definitions) usano `createRequestScopedDefinitionCache()` con deduplicazione per singola richiesta e rete `no-store`.

**Code review effettiva:** è stata ricevuta la route aggiornata di 3021 righe, e notata la regressione dovuta alla rimozione del vecchio `withRetry` dai lookup statici centrali: la cache centrale non sostituisce il retry di errore. Una seconda versione della route, `inventory-route-MF-A1b-reviewed.ts`, ha ripristinato retry bounded per InventoryItem/Stat/PlugSet senza reintrodurre cache globali duplicate. Da ChatGPT sono stati riportati controlli sintattici e test sintetici isolati, **non** una compilazione end-to-end su Windows. Dopo l’applicazione, l’utente ha risposto: **«funziona tutto»**. Non aggiungere un’ulteriore richiesta AI a pagamento per verificare questa fase.

**Test e limiti da distinguere:** per la prima implementazione Devin ha riferito `npx tsc --noEmit` superato e 6 test sintetici; per la variante revisionata ChatGPT ha riferito verifica TypeScript isolata e test retry. L’utente ha confermato il funzionamento generale in app per la variante revisionata; il risultato di `npx tsc --noEmit` *dopo* quest’ultima sostituzione non è stato esplicitato separatamente nell’ultimo messaggio. Nessun benchmark prestazionale prima/dopo, nessun test osservato di cambio versione live a metà richiesta. Le definizioni generiche non sono ancora globalmente versionate e possono essere recuperate più volte tra richieste, ma senza cache stale persistenti nella route.

**Decisione di roadmap:** MF-A1b chiusa sul comportamento verificato; passare a `MF-B0 — Italian Manifest Catalog Decision Sprint`, senza estendere nuovamente la route, senza rifare la cache e senza confondere i dati delle definizioni con statistiche/roll/sbloccati dei Guardian. Registrare un commit Git di baseline con file modificati e documentazione dopo aver verificato il diff locale. UI v2 progettata parallelamente, non riscrittura immediata.

### MF-B0 — Compito successivo NELLO SNAPSHOT DEL 12/10 (storico; stato corrente nelle sezioni 17–20)

1. Leggere `AGENTS.md`, versione attuale di `manifest.ts`, `next.config.ts`, `package.json` e deployment previsto; analizzare il formato mobile SQLite italiano Bungie e gli eventuali component JSON italiani ufficiali da `GetDestinyManifest` (`Response.version`, percorsi locali per `it`).
2. Controllare la dimensione effettiva del pacchetto compresso e del database dopo estrazione, requisito del filesystem e modalità di aggiornamento; evitare numeri inventati e non scaricare file grandi senza autorizzazione.
3. Confrontare tre opzioni: continuare on-demand, importare snapshot SQLite server-side versionato, generare un piccolo indice precalcolato per la UI. Scelta motivata da latenza, spazio, cold start, Windows/Next.js ed eventuale deployment serverless.
4. Proporre un **solo** primo checkpoint tecnico delimitato (un file alla volta); nessuna nuova pagina, nessun algoritmo di build modificato, nessun download integrale prima di una decisione esplicita.
5. UI v2 in parallelo: snapshot equipaggiamento Bungie read-only, quattro moduli (Armature, Armi, Abilità/Sottoclasse, Artefatto), Full Build AI distinto. **Leggibilità** come priorità.


---

## 17. AGGIORNAMENTO 13–16/10/2026 — Manifest/UI v2 e focus Armor Engine

**Fonte:** risultati condivisi dall'utente, audit JSON/Bungie e patch consegnate in chat; **non un nuovo audit completo del repository Windows**.

- **Manifest MF-B1:** sono stati svolti step tecnici di studio/scripting `MF-B1a`, `MF-B1b`, `MF-B1c1` per il Manifest Bungie locale italiano, incluso `scripts/manifest-it-probe.mjs` con correzione `MF-B1c1`. **MF-B1d (verifica della versione locale/aggiornamento coerente) rimane aperta**. Il catalogo SQLite locale italiano non va dato per definitivamente integrato in tutta l'app; non scaricare o reingegnerizzare il Manifest senza un checkpoint mirato.
- **UI v2:** base implementata a `/guardian/[characterId]/assistant-v2`; direzione confermata: Armor Optimizer ispirato a DIM, intervalli Min/Max assoluti per ciascuna delle 6 statistiche, controlli visuali ordinati, sezione Armor e altri moduli secondo roadmap. Esiste una pagina diagnostica separata `/guardian/[characterId]/assistant-v2/armor-audit`. Le funzioni UI attuali non autorizzano a saltare il nuovo motore di correttezza.
- **Legacy:** `src/lib/destiny-builder/armorOptimizer.ts` resta un engine preesistente con problemi noti: basato in parte su valori osservati già modificati, non equivalente al nuovo ottimizzatore del roll di origine, e non garantisce tutte le regole Min/Max/Armor 3.0. **Non modificarlo durante B0.5b6**. Conservare Legacy Assistant e i percorsi del Builder.
- **Regola per il nuovo motore:** sei roll di origine + contributi simulati da plug/slot pertinenti + verifica di condizioni e disponibilità. Distinguere sempre **correttezza matematica**, **segnali Bungie live**, **legalità della configurazione**, **proprietà/sblocco** e **certificazione per l'Optimizer**.

### Stat ID di Armor 3.0 (hash, ordine canonico)

| Stat | Hash |
|---|---:|
| Weapons | `2996146975` |
| Health | `392767087` |
| Class | `1943323491` |
| Grenade | `1735777505` |
| Super | `144602215` |
| Melee | `4244567218` |

Sono possibili **contributi negativi** da tuning (per esempio Health −5); questo non implica che il roll base debba essere negativo. Non troncare un totale osservato sotto zero per mascherare errori. Hash e provenienza, non nomi localizzati, guidano la logica.

## 18. ENGINE-B0 — Registro checkpoint verificati (14–16 ottobre 2026)

### B0.1 — Evidence API (✅)

- File modificato: `src/app/api/destiny/characters/[characterId]/inventory/route.ts`.
- La risposta `scope=detail` ora comprende `armorStatEvidence`: statistiche Bungie osservate (anche `0` e negative), `investmentStats` di item/plug, plug selezionati e socket. L'evidenza non costituisce automaticamente il roll originario certificato.

### B0.2 → B0.3c — Armor Base Resolver (✅ per riconciliazione, non per ottimizzazione)

- Nuovo/aggiornato: `src/lib/destiny-builder/armorBaseStatsResolver.ts`, `resolveArmorBaseStats`.
- Ricostruzione conservativa: definizione item + `armor_stats` + `intrinsics` selezionati, mod stat nel socket `enhancements.v2_general`, tuning nel socket `core.gear_systems.armor_tiering.plugs.tuning.mods`. Riconcilia precisamente con le 6 stat live dell'istanza.
- Balanced Tuning plugHash `3122197216`: **+1 alle tre statistiche più basse dopo le mod dirette e prima del tuning**; se terza e quarta sono pari, rifiutare (nessuna selezione arbitraria). Alcuni plug intrinsici risolti dichiarano `investmentStats: []` e non devono bloccare la riconciliazione per ciò solo.
- Progressione reale: B0.3a **3/8** casi riconciliati → B0.3b **5/8** → B0.3c **8/8**, senza errori Bungie. Ulteriori audit con quattro armature hanno confermato **4/4**.
- `status: reconciled_roll_candidate` significa *roll candidato*, mai `certifiedForOptimization: true` (ancora `false`); non degradare i controlli per “sbloccare” l'Optimizer.

### B0.4 — Test Resolver (✅ per copertura dichiarata, con caveat)

- Test deterministici riferiti da Devin: **15/16**, un caso Balanced senza tie era stato saltato. Il comportamento Balanced senza tie è stato poi coperto e superato dai test B0.5a. Non presentare la vecchia suite come 16/16.

### B0.5a — Armor Modifier Simulator (✅; PC utente)

- `src/lib/destiny-builder/armorModifierSimulator.ts` e `test-armor-modifier-simulator.ts`.
- Correzioni rispetto al primo tentativo Devin: niente doppio Balanced, input non mutati, hash/duplicati/overflow validati, `baseTotal`, `totalChange`, `simulatedTotal`, provenienza preservata; risultato `mathematicallyValid` separato da `installabilityVerified: false`.
- **Utente Windows:** `npx tsc --noEmit` passato e `npx tsx test-armor-modifier-simulator.ts` → **42/42 PASS, 0 skipped**. Include Crown of Tempests, Balanced e otto fixture di audit reale.

### B0.5b1–b5 — Evidence di disponibilità e audit (✅ diagnostica)

| Fase | File / cambiamento | Verifica riportata |
|---|---|---|
| **B0.5b1** | `inventory/route.ts` più `armor-audit/page.tsx`: opzioni per socket dal Manifest e item live, fonti e segnali `canInsert`, costo/energia osservato; nessuna certificazione. | **4/4** reali; stat mods senza alternative item-reusable live, tuning con alternative live. |
| **B0.5b2** | Nuovo `src/lib/destiny-builder/armorModifierAvailability.ts` + `test-armor-modifier-availability.ts`: separa installate, live candidate, manifest candidate, blocked, unknown; simulabilità senza certificazione. | **Utente Windows:** `tsc` passato e **30/30** test. |
| **B0.5b3** | `armor-audit/page.tsx`: usa modello sull'elenco completo, esporta rapporto sintetico. | Audit reale **4/4**, 0 errori. |
| **B0.5b4** | `armor-audit/page.tsx`: diagnostica `plugSources`; successivo fix di React key `String(entry.socketIndex)` per errore `TS2322`. | Audit reale **4/4**, sorgenti confermate. |
| **B0.5b5** | `inventory/route.ts` + `armor-audit/page.tsx`: join fra socket del dettaglio e `ProfilePlugSets` / `CharacterPlugSets` già presenti nel caricamento `scope=core`. | Audit reale **4/4**, 0 errori, **13 opzioni condivise** con segnale live per socket stat. |

**Risultato tecnico B0.5b4:** socket stat generale (es. socket index 0) `socketTypeHash=1718047805`, `plugSources=13`: `inventory_sourced + profile_plug_set + character_plug_set`, ma `liveReusableDataPresent=false`. Socket tuning `socketTypeHash=2581339086`, `plugSources=7`: `inventory_sourced + item_reusable + profile_plug_set`. Questo spiega perché le stat mod risultavano `manifest_candidate` senza dati item-reusable; non significa che siano bloccate.

**Risultato B0.5b5:** per tutte e quattro le armature il socket stat ha 1 PlugSet referenziato/trovato, 4 voci nel ProfilePlugSet + 9 nel CharacterPlugSet, **13 hash distinti, 13 con segnale live positivo**, 13 già nel catalogo Manifest, 0 esterni, `missingSharedComponent=false`. Anche il tuning vede 1 opzione condivisa dal profilo, oltre alle sue opzioni item-reusable. Le 13 voci comprendono anche plug per svuotare socket; non presupporre che siano tutte bonus +5/+10 o possedute.

**Audit B0.5b5 del 16/10, campione (quattro roll riconciliati, in ordine Weapons/Health/Class/Grenade/Super/Melee):**

| Armatura | Origine | Roll candidato | Osservato dopo mod/tuning |
|---|---|---|---|
| Geomag Stabilizers (esotica, gambe) | equipaggiata | `[20,0,0,30,25,0]` | `[20,-5,0,30,40,0]` (Super Mod +10, Super/Health +5/−5) |
| Swordmaster's Cover (leggendaria, casco) | equipaggiata | `[0,25,0,0,20,30]` | `[1,25,1,1,25,30]` (Minor Super +5, Balanced) |
| Luminopotent Gloves (leggendaria, guanti) | inventario | `[30,20,0,0,25,0]` | `[30,20,1,6,25,1]` (Minor Grenade +5, Balanced) |
| Stormdancer's Brace (esotica, torace) | deposito | `[0,0,0,30,25,20]` | identico (nessuna stat mod/tuning con effetto) |

**Criticità del 16/10, poi risolta parzialmente in B0.5b6:** in B0.5b5 il modello NON integrava ancora i PlugSet shared, quindi le stat mods apparivano solo `manifest_candidate`. **Questo limite è stato risolto come evidenza di disponibilità in B0.5b6** (audit reale 4/4). Restano aperti **installabilità, tier, sblocco, compatibilità energetica, proprietà Guardian/Vault e legalità completa dei socket**; si vedano le sezioni 21–22. `installabilityVerified` e `certifiedForOptimization` restano **false**.

## 19. SNAPSHOT STORICO AL 16/10 — Engine-B0.5b6 (✅ COMPLETATO SUCCESSIVAMENTE; NON RIPETERE)

**Obiettivo:** estendere **solo il modello conservativo** di disponibilità per incrociare `modifierAvailability` con i PlugSet condivisi, evitando una falsa `installabilityVerified=true`. Poi aggiungere test, poi l'integrazione audit, **una modifica di codice per volta**, sempre `npx tsc --noEmit` dopo ogni patch.

**Patch predisposte nella sessione precedente, NON ancora consegnate/installate dall'utente:**

1. `src/lib/destiny-builder/armorModifierAvailability.ts` — unione con evidenze Profile/Character PlugSet associate tramite hash di set/socket; conservare provenienza e stati; non promuovere elementi dal solo Manifest.
2. `test-armor-shared-plugset-availability.ts` — nuovo set di test isolati, più regressione della suite B0.5b2 da **30** test.
3. `src/app/guardian/[characterId]/assistant-v2/armor-audit/page.tsx` — riepilogo aggregato, distinguendo signal shared vs item-reusable; no nuove chiamate Bungie, nessun ID privato nel rapporto.

Gli ZIP predisposti erano denominati `DestinyBuilder_Engine_B0_5b6_01_Shared_Availability_Model.zip`, `_02_Shared_Availability_Tests.zip`, `_03_Shared_Availability_Audit.zip`; **il nome del pacchetto non è prova che sia installato, testato o approvato**. In nuova chat controllare il contenuto delle patch e i file originali del repository prima di consegnare istruzioni; chiedere log di `npx tsc --noEmit` + suite precedente e nuova, quindi audit reale su quattro armature. Se i file ZIP non sono in quella chat, richiederli o ricrearli partendo dal codice corrente condiviso, senza assumere accesso al vecchio sandbox.

**Casi di fallimento da preservare:** shared set non corrispondente, segnali `canInsert` o `enabled` falsi/assenti, socket disabilitato, contraddizioni fra sorgenti, plug senza definizione/effetti, duplicati, requisito Guardian non verificato, opzioni soltanto Manifest, costi assenti/superiori, Balanced non coerente. Queste condizioni NON diventano “legalmente equipaggiabile” solo perché la somma dei bonus è corretta.

**Divieti:** non toccare `armorOptimizer.ts`, engine Legacy/Build Assistant, Builder Preview, OAuth o scritture Bungie; no nuove chiamate OpenAI, né spese o refactoring diffusi, niente JSON grezzi con ID privati.

### Dopo B0.5b6 — orientamento, NON ancora approvato come implementazione

- Completare la verifica di installabilità di configurazione intera: costi/energia residuali, condizioni, socket, unlock, requisiti di tier/masterwork quando dimostrabili e reale appartenenza dell'opzione al Guardian previsto. `unknown` rimane `unknown`.
- Avviare **Engine-B0.6** solo quando gli input sono attendibili: ricerca delle 5 armature possedute, tuning e mod legalmente combinabili, intervalli **Min/Max assoluti**, slot/esotiche e ulteriori vincoli Armor 3.0. L'optimizer esistente rimane intatto fino a prova del nuovo motore.
- Riprendere **MF-B1d** come checkpoint Manifest separato; non perdere cache/performance/Italian catalog; nessuna migrazione big-bang.
- UI/UX leggibile è obbligatoria a ogni macrofase: il debug audit non sostituisce la vista Armor Optimizer per l'utente finale.

## 20. ISTRUZIONI STORICHE PER CHAT 16/10 (SUPERATE DALLE SEZIONI 21–22)

Caricare **entrambi** i file `docs/DESTINY_BUILDER_PROJECT_MEMORY.md` e `docs/NEXT_CHAT_START.md`. L'handoff più recente **non è una nuova roadmap ufficiale**: prima di qualsiasi patch verificare anche `AGENTS.md`, eventuale `ROADMAP.md` canonica e i file presenti sul PC. Questo paragrafo è lo snapshot precedente; **non iniziare più da B0.5b6**, già verificata. Iniziare dal checkpoint indicato nella sezione 22 e non da MF-B0, B0.5a o dalla progettazione generica; riportare espressamente gli stati `completed / pending user validation / future`.

Eseguire in PowerShell, dalla radice `C:\Projects\DestinyBuilder\destiny-builder`, dopo ogni patch:

```powershell
npx tsc --noEmit
# per B0.5b6: rieseguire anche la suite già passata
npx tsx test-armor-modifier-availability.ts
# se il file è presente dopo la relativa patch
npx tsx test-armor-shared-plugset-availability.ts
```

Solo dopo test locali riusciti ripetere `/guardian/[characterId]/assistant-v2/armor-audit` su 4 armature e inviare **Copia rapporto senza ID**. Nessuna attestazione di successo fino a esito verificato.


---

## 21. AGGIORNAMENTO 16–17/10/2026 — CHIUSURA B0.5b6, B0.5c1/c2, B0.5c3a (v1.7)

**Fonte/evidenza:** comandi e output forniti dall'utente sul PC Windows, rapporto JSON “Copia rapporto senza ID” da Bungie il 16/10, sorgenti e patch condivisi nella chat. Non è stato eseguito un audit Git completo o un nuovo audit live Bungie dopo B0.5c3a.

### Engine-B0.5b6 — Shared PlugSet Availability Integration (✅ con audit reale)

- Applicate nell'ordine tre patch separate: `src/lib/destiny-builder/armorModifierAvailability.ts`; nuovo `test-armor-shared-plugset-availability.ts`; `src/app/guardian/[characterId]/assistant-v2/armor-audit/page.tsx`.
- Iniziale `tsc` fallito con **6 errori non del codice principale** perché una cartella `Engine-B0.5b6-source-review/` con copie parziali era rimasta nella root del progetto. La cartella è stata **spostata fuori dal repository** in `%TEMP%`, poi `npx tsc --noEmit` senza errori.
- **PC utente:** suite nuova 46/46 PASS e regressione availability 30/30 PASS; TypeScript PASS.
- **Rapporto Bungie reale 16/10:** 4/4 armature `reconciled_roll_candidate`, 0 insufficient, 0 unreconciled, 0 requestErrors, `sharedEvidenceState:valid` su tutte, 0 shared conflicts. 13 opzioni shared positive per ogni socket generale di mod (4 profile + 9 character, incluse opzioni `Empty Mod Socket`); per ciascun socket generale 12 alternative `live_candidate`, l'altra già installata. I conteggi complessivi di alternative includono anche tuning individuali e NON equivalgono a 13 nuove armature o a 13 configurazioni certificate. 
- `availabilityModel.installabilityVerified=false` e `certifiedForOptimization=false` su tutte; l'audit prova join e segnali live, NON conferma le regole di installazione complessiva.

### Engine-B0.5c1 — Conservative Installability Preflight (✅ implementazione/typecheck)

- Creato `src/lib/destiny-builder/armorInstallabilityValidator.ts` (directory con trattino, **non** `destinyBuilder`; controllato con `Test-Path` True/False).
- Verifiche indipendenti tri-state `passed/blocked/unknown`: disponibilità, bilancio energetico post-swap, proprietario/posizione Guardian, socket, tier, sblocco, tipo energia.
- `overallInstallable:false` e `installabilityVerified:false` **sempre**. Non chiama Bungie/OpenAI, non equipaggia e non trasferisce nulla.
- I controlli tier/sblocco/energy type specifici restano `unknown` in mancanza di regole/evidenza affidabile. Una `live_candidate` è un segnale, non una certificazione. `Vault` = ownership `unknown` per installazione immediata, non oggetto vietato per future proposte trasportabili.

### Engine-B0.5c2 — Assertion Tests e correzione (✅ PC utente)

- Prima versione test Devin: stampava *Expected* e risultato senza `assert`, quindi `All tests completed` **non era un PASS valido**. Inoltre la prima implementazione aveva errori su costo zero, `manifest_candidate`, selezionato, limite improprio a 10 e tri-state.
- Creato/revisionato `test-armor-installability-validator.ts` con **34 vere asserzioni**; corretta successivamente la versione del solo `armorInstallabilityValidator.ts`.
- **PC utente:** `npx tsc --noEmit` PASS, 34/34 + 46/46 + 30/30 = **110/110** PASS. Confermate coerenza del socket selezionato, zero-cost non mancante, energyCapacity osservata 11, blocchi/unknown, no ID privati nel risultato, nessuna certificazione.

### Engine-B0.5c3 — Audit read-only → B0.5c3a — Evidence Consistency (✅ PC utente 17/10)

- Revisione della route `src/app/api/destiny/characters/[characterId]/inventory/route.ts` (lettura soltanto), dell'Availability e del Validator: `itemEnergyEvidence` è ottenuta da `instance.energy` (dati opzionali, potenzialmente legacy), `declaredEnergyCost` è estratta da `plug.plug.energyCost` nel Manifest. Anche se sono numericamente presenti, la loro *semantica Armor 3.0* e l'installabilità completa rimangono da verificare.
- Gap confermati in B0.5c3: `currentEnergy`, `oldPlugCost`, `newPlugCost` esterni potevano essere incoerenti con `availabilityAssessment.energyEvidence` e `option.declaredEnergyCost`; `ownership` passava talvolta con posizione `unknown`.
- **B0.5c3a Patch 01:** solo `test-armor-installability-validator.ts` (34 → **48** test, **14** nuovi).
- **B0.5c3a Patch 02:** solo `src/lib/destiny-builder/armorInstallabilityValidator.ts`. Incrocia costi vecchio/nuovo dichiarati con i parametri esterni, verifica che l'energia della proposta coincida con `energyEvidence` (capacità, usata, tipo), gestisce assenze/contraddizioni come `unknown`, richiede posizione `inventory`/`equipped` nota per ownership passed; conserva Vault/other Guardian e tri-state prudenti.
- **ULTIMO TEST EFFETTIVO WINDOWS, 17/10/2026:**

  ```powershell
  npx tsc --noEmit
  npx tsx test-armor-installability-validator.ts
  npx tsx test-armor-shared-plugset-availability.ts
  npx tsx test-armor-modifier-availability.ts
  ```

  **TypeScript PASS**, test **48/48 + 46/46 + 30/30 = 124/124 PASS**, `0 failed`, `0 skipped`. Il `npm notice` su npm 11.19.0 → 12.2.0 è puramente informativo; non si è richiesto aggiornamento. Test locali puramente deterministici; **non è stato riportato un nuovo audit di installabilità live dopo B0.5c3a**.

### Limiti aperti NON rimossi dai test

1. Semantica di `instance.energy` e `plug.energyCost` per Armor 3.0 non certificata; coerenza numerica del costo non prova installabilità nel gioco.
2. Controlli specifici socket/affinity, tier/masterwork, unlock, vendor/stagionalità, Guardian/proprietà effettiva e trasferimenti ancora incompleti o `unknown`.
3. La convalida riguarda **una singola sostituzione** e gli input disponibili; non certifica una configurazione completa di 5 armature.
4. Resolver `reconciled_roll_candidate` ≠ roll definitivamente certificato; `certifiedForOptimization:false` rimane invariato.
5. Nessun equip/transfer/write Bungie dall'Armor Optimizer. `armorOptimizer.ts` legacy e UI v2 non vanno riscritti in questa fase.
6. Lo stato Git attuale e la roadmap ufficiale nel repository vanno ricontrollati: in un precedente `git status --short` risultavano modifiche e file non tracciati; **non è confermato un commit di baseline**.

## 22. AVVIO NUOVA CHAT DOPO B0.5c3a — CHECKPOINT OPERATIVO

**Stato al 17/10/2026:** B0.5c3a concluso (124/124 + tsc sul PC), B0.5b6 già validato anche con audit reale 4/4. **Non riaprire B0.5b6 o B0.5c2**, salvo regressioni. Non chiamare OpenAI/Bungie per test senza approvazione.

**Prossima attività consigliata, soggetta alla roadmap ufficiale:** `Engine-B0.5c3b — Armor 3.0 Constraint Evidence Decision` in **sola lettura** per prima cosa. Verificare se i dati della route/Manifest e le regole documentate supportino davvero un gate di costo/energia o altre restrizioni; definire un contratto di provenienza e validare come `unknown` i campi non verificabili. Una piccola implementazione o test viene proposta **solo dopo** il report e l'approvazione dell'utente, un file per volta. Nessuna fretta di promuovere `passed` a `certified`.

**File da verificare prima di scrivere codice:** `AGENTS.md`, roadmap canonica (se esiste), `src/lib/destiny-builder/armorInstallabilityValidator.ts`, `armorModifierAvailability.ts`, `armorModifierSimulator.ts`, `armorBaseStatsResolver.ts`, `src/app/api/destiny/characters/[characterId]/inventory/route.ts`; eventuali test `test-armor-installability-validator.ts`, `test-armor-shared-plugset-availability.ts`, `test-armor-modifier-availability.ts`. Attenzione a versioni installate più nuove rispetto agli allegati di questa chat.

**Test di regressione dopo ogni patch futura**: `npx tsc --noEmit`; 48 installability + 46 shared + 30 availability; se coinvolta matematica del simulatore, rieseguire anche `npx tsx test-armor-modifier-simulator.ts` (storicamente 42/42). Solo quando pertinente e autorizzato, audit reale su 4 armature via UI `assistant-v2/armor-audit` con **Copia rapporto senza ID**. Registrare sempre costo, fonte, errori e cosa è effettivamente stato testato.

**Non fare ora:** `Engine-B0.6` ricerca combinazioni 5 armature con Min/Max, modifiche all'Optimizer legacy, equip/scritture Bungie, chiamate AI a pagamento, refactoring big-bang UI, Acquisition Planner/Lore/Power. MF-B1d rimane task separato in attesa.

**Handoff:** conservare sia questo documento aggiornato sia `docs/NEXT_CHAT_START.md` nel repository. Prima di sostituire file locali eseguire backup/confronto diff; i download di questa chat **non aggiornano automaticamente né Git né il disco Windows**. Se si vuole salvare un commit di baseline, verificare prima `git status --short`, diff e segreti. Non includere `.env.local`, OAuth token o identificativi privati.

---

## 23. AGGIORNAMENTO 17–18/10/2026 — B0.5c3d/e E B0.6a1–a3 (v1.8)

### Armor installability conservativa (storico chiuso per i test)

- Da `B0.5c3b` a `B0.5c3d2c` si è estesa la lettura di evidenze Manifest/socket/PlugSet senza equip o scrittura Bungie. Audit del 18/10: **4/4** armature con statistiche riconciliate, **0** errori API, **8/8** socket della whitelist verificati, **224/224** confronti opzioni allowed, **0** esclusi/unknown e **0** conflitti live nel campione. Sono prove di disponibilità/corrispondenza dei segnali osservati, **non** di legittimità/installabilità completa della mod.
- `B0.5c3e`: gate prudente sul socket, `live_candidate` + whitelist allowed NON promuove a installabilità complessiva. Test sul PC utente: **65/65** `test-armor-installability-validator.ts` e `npx tsc --noEmit` PASS. Rimangono `overallInstallable:false`, `installabilityVerified:false`, `certifiedForOptimization:false` dove applicabili. Non ripetere il falso gate che promuove candidate/installed a permesso di inserzione.

### `Engine-B0.6a1` — Search core (✅ Windows)

- File `src/lib/destiny-builder/armorCombinationEngine.ts` e `test-armor-combination-engine.ts`.
- Ricerca deterministica **cinque slot** (casco, guanti, torace, gambe, oggetto classe), solo dettagli per istanza completi e `reconciled_roll_candidate`. Sei statistiche Armor 3.0, intervalli Min/Max assoluti, pesi, una sola esotica, pin, classi, limiti di budget e risultati `truncated` espliciti. Distingue roll base e statistiche degli oggetti con mod/tuning **già applicati**; Vault/altro Guardian richiedono trasferimento ma non lo eseguono. Non ottimizza legalmente nuovi socket/mod, non certifica stat finale del Guardian.
- **Windows:** `npx tsc --noEmit` PASS, **25/25** test PASS (18/10).

### `Engine-B0.6a2` — UI Bridge (✅ Windows/browser)

- File `src/lib/destiny-builder/armorCombinationUiBridge.ts`, test `test-armor-combination-ui-bridge.ts`, pagina `src/app/guardian/[characterId]/assistant-v2/page.tsx`. UI nuova con `Cerca B0.6 · Min/Max`, motore legacy separato e read-only.
- **Windows:** 15/15 bridge + 25/25 engine = **40/40** PASS, TypeScript PASS. Browser: screenshot di 5 risultati, 24 pezzi idonei, 77 combinazioni valutate; i vincoli esemplificativi Granata 107–171, Super 47–150, Armi 81–167 erano rispettati. Esito non significa top globale se i dettagli disponibili sono incompleti.

### `Engine-B0.6a3` — Equipped snapshot + queue (✅ Windows)

- File `src/lib/destiny-builder/armorEquippedSnapshot.ts`, `test-armor-equipped-snapshot.ts`, pagina v2. Il pannello stat equipaggiato legge solo dettagli riconciliati e mostra Σ per somme parziali (non minimi); include tuning/mod anche negativi.
- Coda manuale fino a 32 dettagli alla volta, concorrenza 2, priorità equipaggiati, avanzamento, annullamento e retry controllato. **Windows:** 16/16 + 15/15 + 25/25 = **56/56** PASS, `npx tsc --noEmit` PASS. Il caricamento manuale non va confuso con la successiva sincronizzazione automatica.

## 24. AGGIORNAMENTO 18–19/10/2026 — SQLITE E SINCRONIZZAZIONE INCREMENTALE (v1.8)

### Obiettivo approvato dall'utente

Un solo recupero iniziale progressivo per gli oggetti posseduti, dettagli persistenti tra riavvii, identificazione degli oggetti nuovi/variati a ogni snapshot Bungie, riutilizzo nella ricerca build. Distinguere *definizioni statiche Manifest* (già cache versionata MF-A1) da *dettagli delle istanze private* (nuovo SQLite). Nessuna connessione a servizi esterni non autorizzati o sincronizzazione in background con app chiusa promessa.

### `SYNC-1` — Persistenza SQLite (✅ Windows)

- `src/lib/destiny-builder/itemDetailStore.ts` + `test-item-detail-store.ts`, `node:sqlite` integrato Node v24.20.0, **nessuna dipendenza npm aggiuntiva**. DB fuori dalla cartella public, per account, senza token. Salvare coppia itemInstanceId/itemHash solo se osservata; snapshot parziale non può segnare assenze. Snapshot completo deve distinguere assenza reale e presenza; identità private non loggate.
- **Windows:** `npx tsc --noEmit` e **19/19** PASS; persistenza/reopen, account isolation, Vault moves, fingerprint, invalidazione, oggetti riapparsi.

### `SYNC-2a` — Coda incrementale (✅ Windows)

- `src/lib/destiny-builder/itemDetailSync.ts` + `test-item-detail-sync.ts`. Conversione snapshot a copertura completa/parziale, coda bounded, max due richieste contemporanee e 32 dettagli per singolo batch, abort, errori e fingerprint. Nucleo puro/injected-loader, non una route autonoma.
- **Windows:** 19/19 nuovi + 19/19 SYNC-1 = **38/38** PASS, TypeScript PASS.

### `SYNC-2b` — Route autenticata e cache-read (✅ Windows)

- `src/lib/destiny-builder/itemDetailProfileBridge.ts` + `test-item-detail-profile-bridge.ts`; integrazione `src/app/api/destiny/characters/[characterId]/inventory/route.ts`.
- `scope=core/account` indicizzano le istanze osservate lato server; `scope=detail` salva solo un dettaglio live con identità coerente; `scope=cached-details` serve batch limitati di coppie istanza/hash sotto l'account autenticato, **senza GetItem**, etichettati come cache e non come verifica live.
- **Windows:** 28/28 + 19/19 + 19/19 = **66/66** PASS, TypeScript PASS. User ha fornito guide locali `15-route-handlers.md` e `cookies.md`: `await cookies()` è necessario e Route Handler autenticati non devono essere staticamente cache-izzati.

### `SYNC-2c` — Auto-hydration iniziale (✅ Windows; hotfix live validato)

- `src/lib/destiny-builder/itemDetailClientSync.ts` + `test-item-detail-client-sync.ts`, integrazione Armor v2. Prima recupero cache, poi live solo mancanti/stale in background; concorrenza 2, budget iniziale fino a 256 dettagli, pausa e avanzamento; errore SQLite non scatena fetch all'intero inventario.
- **Windows:** 20/20 + 28/28 + 19/19 + 19/19 = **86/86** PASS, TypeScript PASS (18/10). Prima UI mostrava cache 0 dopo refresh: bug reale.
- `diagnose-item-detail-cache.mjs` read-only mostrò **657** istanze attive, **176** dettagli salvati e corrispondenti, **0** fingerprint modificati, **0** eleggibili con vecchio cutoff 6h; dimostrò che SQLite scriveva e la scadenza/invalidazione andavano separate. **Non è un conteggio attuale dell'inventario.**
- **Hotfix:** in `itemDetailStore.ts` lo snapshot completo non deve marcare temporaneamente tutti assenti e poi trattarli come riapparsi cancellando i dettagli validi. Test `test-item-detail-full-snapshot-regression.ts` **8/8** nuovi + 86 pregressi = **94/94 offline**. Browser utente dopo patch: **457 cache, 0 download nuovi, 0 rimanenti, 5/5 equipaggiati riconciliati**. È prova dell'effettivo riutilizzo; il database non va cancellato per validare una patch.

### `SYNC-3a` — Aggiornamento intelligente (✅ feedback UI utente; test offline)

- Evoluzioni dei file `itemDetailStore.ts`, `itemDetailClientSync.ts`, `inventory/route.ts`, `assistant-v2/page.tsx`; test `test-item-detail-smart-refresh.ts`.
- Nuovi oggetti recuperati automaticamente; dati persistiti *riutilizzabili da cache* ≠ *necessità di ricontrollo*; refresh indicativo per equipaggiati ~6h, altri ~3 giorni, limite duro ~30 giorni; solo 8 ricontrolli periodici per apertura, concorrenza 2, recheck aggiuntivi su gesto esplicito. Cambi osservabili => aggiornare subito. Cambi di posizione non invalidano inutilmente l'istanza. Le modifiche prive di fingerprint osservabile possono aspettare il ricontrollo periodico.
- **Assistente:** 19/19 nuovi e 113/113 test SYNC combinati riportati PASS **offline**, controlli isolati TypeScript/TSX; **utente:** «funziona» nella propria app. Non abbiamo un nuovo log CLI Windows completo per questa fase nella chat.

## 25. AGGIORNAMENTO 19–20/10/2026 — `SYNC-3b1` (ULTIMO CHECKPOINT CONFERMATO)

### `SYNC-3b1` — Cache-first condivisa Builder/Vault/Inspector (✅ browser utente)

- Sorgenti patch: `src/lib/destiny-builder/sharedItemDetailCache.ts` (nuovo), `src/app/guardian/[characterId]/page.tsx`, `src/app/vault/page.tsx`; test `test-shared-item-detail-cache.ts`.
- `ensureItemDetail` nel Builder e flussi Vault Inspector + Compare Tray usano un adattatore comune `scope=cached-details` prima di `scope=detail`, verificando **itemInstanceId e itemHash**. Cache valida evita Bungie; mancante/stale/identità incoerente => recupero richiesto dalla route live o esclusione conservativa. Refresh esplicito può richiedere live.
- Nessun cambio a trasferimenti reali Vault, anteprima Build salvata, motore B0.6, Legacy, Manifest o schema DB. Nessun secondo sync globale avviato fra le pagine: **questo viene affrontato in SYNC-3b2**.
- **Assistente:** 18/18 test del helper/adapter e controlli di parsing delle due TSX riportati PASS offline. **Utente:** conferma successiva «funziona tutto». Non abbiamo un log della suite 18/18 eseguita sul suo Windows; non dichiararlo.

### Evidenza e salvaguardie

- Un dettaglio letto da SQLite è un valore salvato, **non prova che perk/socket/tuning siano identici allo stato Bungie live nel momento della lettura**; conservarne fonte/freschezza. `unknown` non diventa 0/passato.
- Cache per account; niente token/ID nei log o nell'AI; no account-mixing; niente fetch massivo se cache non è accessibile. Il DB privato locale SQLite **non sostituisce** il Manifest statico/localizzato.
- Destinazione principale Windows: `C:\Projects\DestinyBuilder\destiny-builder`; leggere repo/git status e `ROADMAP.md` reale prima di patch. `AGENTS.md` comanda consultazione documentazione `node_modules/next/dist/docs/` per nuove modifiche Next.js.

## 26. PROSSIMO INTERVENTO E QUICK-HANDOFF v1.8 — `SYNC-3b2` (NON IMPLEMENTATO)

**Obiettivo autorizzato dalle conversazioni:** un coordinatore **unico di sincronizzazione a livello app**, non legato soltanto alla pagina Armor v2. Passando tra Builder, Vault e Armor Optimizer non deve iniziare ogni volta un download duplicato; utilizzare snapshot Bungie attuale, SQLite e differenziale per istanza, con controllo di concorrenza/budget, progresso e annullamento visibili. Lo stato cache-first degli Inspector (3b1) già funziona e va preservato.

**Quattro file chiesti all'utente prima di iniziare SYNC-3b2:**

1. `src/components/destiny-builder/AppShell.tsx`
2. `src/app/layout.tsx`
3. `src/app/guardian/[characterId]/assistant-v2/page.tsx`
4. `src/lib/destiny-builder/itemDetailClientSync.ts`

Ulteriori sorgenti utili **solo se necessari dopo la prima lettura**: `src/lib/destiny-builder/sharedItemDetailCache.ts`, `src/lib/destiny-builder/itemDetailStore.ts`, `src/app/api/destiny/characters/[characterId]/inventory/route.ts` e l'eventuale `ROADMAP.md` del repository. In questa chat **i quattro file nuovi non sono ancora stati allegati**, e i vecchi upload non dimostrano il codice installato dopo SYNC-3a/3b1.

**Sequenza consigliata:** ispezione read-only per evitare provider/sessioni duplicate; test puri per lifecycle, remount/cambio Guardian, single-flight/abort, limiti rate e privacy; poi patch una alla volta (preferibilmente un file/ZIP), `npx tsc --noEmit`, suite mirate e **collaudo browser Windows**. Non eliminare o cambiare la funzione Sync Bungie, non alterare il flusso transfer del Vault, la persistenza Draft o l'Armor Optimizer legacy. Non avviare automaticamente sync on-load globale senza che l'utente abbia capito il limite della prima importazione e le salvaguardie.

**Dopo SYNC-3b2:** pianificare `Engine-B0.6a4` per applicare **su scelta esplicita** una combinazione Armor alla sola Builder Preview; le scritture Bungie appartengono ad altri flussi e restano fuori. `MF-B1d` del Manifest italiano rimane separata/pending.

**Comandi di regressione disponibili (eseguirli se i file test sono presenti):**

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

**Regole sempre valide:** roadmap reale unica fonte di verità; versioni installate prima di qualsiasi patch; `AGENTS.md` e guide locali Next.js; un file per ZIP; backup+diff; no nuove dipendenze/paid AI, no scritture Bungie dall'Optimizer, niente ID/token in export; distinzione stato Bungie/preview/cache/teorico; `certifiedForOptimization:false` finché non provato. Questi documenti sono **copie per il checkpoint**, non aggiornano da soli Git/Windows.
