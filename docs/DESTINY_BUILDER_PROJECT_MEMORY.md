# DESTINY BUILDER — MEMORIA DEL PROGETTO, ROADMAP E REGISTRO DECISIONI

> **Versione:** 1.5 — 12 ottobre 2026  
> **Ambito:** Destiny Builder / Destiny Build Assistant (non JARVIS/Ghost)  
> **Scopo:** documento di continuità da conservare nel repository e riutilizzare nelle nuove chat con ChatGPT e nei task Devin.  
> **Stato del documento:** ricostruzione basata su conversazioni, resoconti, codice e test condivisi. **Non è un audit completo del repository corrente**. Prima di cambiare codice, verificare i file reali sul PC.  
> **Collocazione suggerita:** `docs/DESTINY_BUILDER_PROJECT_MEMORY.md`.

---

## 0. LEGGERE QUESTO PRIMA DI LAVORARE

**Priorità assoluta:** non perdere il lavoro esistente, non deviare dalla roadmap e non attribuire a un test TypeScript la stessa forza di un test reale dell'app.

**Ultimo checkpoint verificato al 12/10/2026:** `MF-A1b — Inventory Route Cache Coordination` (browser verificato dall’utente; typecheck dichiarato da Devin per la prima implementazione; la successiva variante revisionata è confermata funzionante dall’utente).

- **C5E1/C5E1a/C5E1b/C5E1c:** diagnostica, correzione filtri, audit cache e caricamento dettagli mirato completati secondo Devin. **Test nel browser del 12/10:** su Crown of Tempests, 25 elmi alternativi → 6 eleggibili → 4 non esotici confermati → **4 con dettagli verificati** → **4 fully qualified**. Prima del caricamento erano **0/4**. Questo conferma l'integrazione Bungie/cache/contesto per quel test reale, **non** la validazione completa di una nuova ipotesi AI.
- **Confermato dall’utente:** `npx tsc --noEmit` passa **anche dopo C5E1c**. La C5E1c è chiusa per implementazione, typecheck e test funzionale browser dei 4 sostituti. **Non ancora verificati:** persistenza dei 4 dettagli dopo refresh/reingresso, gestione errori/cambio Guardian su Bungie live ed eventuale preflight completo con Contraverse Hold. Non effettuare chiamate OpenAI a pagamento solo per chiudere questo checkpoint.
- **MF-A / MF-A1a / MF-A1b concluse:** audit dell’accesso alle definizioni statiche; `manifest.ts` version-aware con caching centralizzato; route inventory senza Promise cache globali duplicate e con generiche request-scoped. Dopo revisione del retry nella route, l’utente ha confermato «funziona tutto».
- **Ora:** `MF-B0 — Italian Manifest Catalog Decision Sprint`: valutare con evidenze (manifest metadata, dimensioni e compatibilità) il caricamento locale del Manifest Bungie ufficiale in italiano; nessuna modifica massiva approvata.
- **In parallelo:** progettazione della **UI v2 leggibile** (read-only build equipaggiata, quattro moduli, Full Build AI separato). La progettazione non autorizza una riscrittura big-bang.
- **Non fare ora:** Acquisition Planner, Power Progression, enciclopedia/lore, Bungie equip writes.

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

Un'applicazione web Destiny 2 che collega l'account Bungie, legge Guardian, equipaggiamento, inventari e Vault, analizza le **meccaniche reali** e **ottimizza le build a partire da ciò che il giocatore possiede o ha effettivamente sbloccato**. Per ora: read-only verso Bungie, con modifiche esplicite soltanto alla *Builder Preview* locale e conferma dell'utente.

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
7. Non effettuare scritture Bungie per equipaggiare oggetti; preview locale soltanto, preferibilmente con review e conferma esplicita.
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

## 6. CHECKPOINT SUCCESSIVO — MANIFEST FOUNDATION

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

### MF-B0 — Compito successivo (studio breve e verificabile, non implementazione massiva)

1. Leggere `AGENTS.md`, versione attuale di `manifest.ts`, `next.config.ts`, `package.json` e deployment previsto; analizzare il formato mobile SQLite italiano Bungie e gli eventuali component JSON italiani ufficiali da `GetDestinyManifest` (`Response.version`, percorsi locali per `it`).
2. Controllare la dimensione effettiva del pacchetto compresso e del database dopo estrazione, requisito del filesystem e modalità di aggiornamento; evitare numeri inventati e non scaricare file grandi senza autorizzazione.
3. Confrontare tre opzioni: continuare on-demand, importare snapshot SQLite server-side versionato, generare un piccolo indice precalcolato per la UI. Scelta motivata da latenza, spazio, cold start, Windows/Next.js ed eventuale deployment serverless.
4. Proporre un **solo** primo checkpoint tecnico delimitato (un file alla volta); nessuna nuova pagina, nessun algoritmo di build modificato, nessun download integrale prima di una decisione esplicita.
5. UI v2 in parallelo: snapshot equipaggiamento Bungie read-only, quattro moduli (Armature, Armi, Abilità/Sottoclasse, Artefatto), Full Build AI distinto. **Leggibilità** come priorità.
