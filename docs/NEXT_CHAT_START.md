# DESTINY BUILDER — AVVIO RAPIDO NUOVA CHAT

**Snapshot:** 12 ottobre 2026 · Handoff v1.2  
**Documento completo:** `docs/DESTINY_BUILDER_PROJECT_MEMORY.md` (allegalo insieme a questo file, se disponibile).

## Messaggio da dare a ChatGPT nella nuova chat

> Sto proseguendo Destiny Builder, web app Next.js/TypeScript per Destiny 2. **Non ricominciare da zero e non cambiare la roadmap senza approvazione**. Leggi `DESTINY_BUILDER_PROJECT_MEMORY.md` allegato e verifica sempre i file reali prima di toccare il codice. **La diagnostica esotiche 8R.6.3C5E1 → C5E1c è stata verificata nel browser:** quattro elmi non esotici e compatibili per sostituire Crown of Tempests sono passati da zero dettagli verificati a **4/4 dettagli verificati e 4 fully qualified**, grazie al caricamento mirato/manuale. Il preflight completo con Contraverse Hold **non è ancora confermato**, ma **`npx tsc --noEmit` PASSA dopo C5E1c (confermato dall’utente)**. **Prossimo checkpoint:** audit `Manifest Foundation`, con progettazione **UI v2 leggibile in parallelo**, senza riscrivere il codice alla cieca e senza chiamate OpenAI a pagamento non richieste. Procedere in italiano, un task/file alla volta.

## Fatti fondamentali

- **Priorità di prodotto:** ottimizzare build utilizzando **solo ciò che il giocatore possiede/ha sbloccato**; risultati AI ipotetici verificati localmente. Tutto il resto (Acquisition Planner, Power Progression, guide Blueberry, enciclopedia/lore) è FUTURO.
- **Roadmap fonte di verità**, niente nuovi moduli fuori fase per entusiasmo. Bug e dipendenze bloccanti sono eccezioni.
- **Ambiente:** Windows 11, Devin Desktop Free, progetto `C:\Projects\DestinyBuilder\destiny-builder`, Next.js App Router/React/TS/Tailwind, Bungie OAuth. Login corretto `/api/auth/bungie`; non `/api/auth/login`.
- **Funziona:** login e sync, tre Guardian, inventari, Vault, Builder Preview locale, Armor Optimizer, Build Candidates, Universal Planning Context, Mechanics Resolver parziale, pacchetto AI limitato, ipotesi con selezioni abilità.
- **C5D2 test reale:** modello propone Voidwalker, Super, granata, melee, aspetti, frammenti e Contraverse Hold; `BLOCKED` perché Crown of Tempests richiede sostituto non esotico con identità/rarità/dettagli verificati. La checkbox `Keep selected exotic armor` **non** controlla direttamente le ipotesi AI contextual nel codice revisionato.
- **C5E1 → C5E1c:** task eseguiti da Devin in `src/app/guardian/[characterId]/assistant/page.tsx`; prima 25 alternative / 6 eleggibili / 4 non esotiche / 0 verificati; dopo pulsante manuale `Load Missing Replacement Details`: **4 verificati e 4 fully qualified** osservati realmente. **TypeScript passato e confermato dall’utente.** Validator immutato; nessuna nuova chiamata AI. Persistenza cache dopo refresh e preflight finale non verificati.
- **Manifest Foundation dopo C5E1:** catalogo di definizioni indicizzato localmente, partendo da ciò che è già usato. Separare Manifest statico, istanze reali del giocatore e ricompense/vendor live.
- **UI v2 in progettazione parallela:** in alto build *equipaggiata su Bungie* sola lettura; sotto quattro moduli **Armature, Armi, Abilità/Sottoclasse, Artefatto**; icone vere, contrasto, gerarchia, filtri strutturati tipo DIM, poco testo. **Full Build AI in pagina separata**, per non confondere ottimizzazione mirata e globale.
- **Dev workflow:** ChatGPT architettura/revisione; Devin task delimitati (minimizzare crediti); utente approva e fa test browser. Una modifica/file alla volta, `npx tsc --noEmit`, niente segreti o API calls non richieste, niente equip su Bungie.

## Prossima conversazione: primo passo pratico

1. **C5E1c chiusa:** test browser 4/4 e `npx tsc --noEmit` confermato dall’utente. Reload/cache e preflight end-to-end sono verifiche aggiuntive, non pretesti per deviare dal prossimo audit.
2. Iniziare **Manifest Foundation (MF-A) come audit read-only**: chiedere/leggere solo i file del progetto necessari per inventariare l'uso del Manifest, distinguere definizioni statiche/istanze live, valutare download IT SQLite/JSON, indexing, versioni e impatto prestazionale; niente big-bang implementation.
3. Progettare contemporaneamente i wireframe della **UI v2**: build Bungie read-only in alto, quattro moduli distinti (Armor/Weapons/Abilities/Artifact), gerarchia visuale e icone; Full Build AI separato.
4. Nessuna nuova chiamata OpenAI per testare Contraverse Hold se non esplicitamente richiesta; possibile successivo test locale deterministico del reconciler.


## Aggiornamento alla fine di ogni sessione

Modificare **entrambi i file** (memoria lunga e quick-handoff) riportando nuova fase, file modificati, test realmente eseguiti, bug e prossima azione. Versionarli nel repository. I file non si aggiornano da soli.
