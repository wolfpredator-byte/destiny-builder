/**
 * ✅ TEST DI FUMO TypeScript — opencode-agent
 * 
 * 🎯 MODALITÀ: Insegnamento - commenti pratici e concisi in Italiano
 * 
 * Scopo: Verifica funzionamento básico di una funzione che rimuove duplicati da array.
 */

import assert = require("node:assert/strict");

// ========================================
// TEST 1: Array CON duplicati originali
// ========================================
const inputWithDuplicates: readonly string[] = ["A", "B", "C", "B", "D", "A"]; // Input: [A, B, C, B, D, A]

// ✅ Chiamata della funzione che rimuove i duplicati mantenendo ordine originale
const unique1 = uniqueStrings(inputWithDuplicates);

// 🔐 assert di Node.js — Verifica che il risultato sia array esatto [A, B, C, D]
assert.deepEqual(unique1, ["A", "B", "C", "D"], 
    "⛔ ERROR: Array con duplicati non restituito correttamente"
);


// ========================================
// TEST 2: Array VUOTO — caso limite
// ========================================
const inputEmpty: readonly string[] = []; // Input: [] → Output dovrebbe essere []

const unique2 = uniqueStrings(inputEmpty); // Chiamata funzione su array vuoto

assert.deepEqual(unique2, [], 
    "⛔ ERROR: Array vuoto non restituito correttamente"
);


// ========================================
// TEST 3: Array SENZA duplicati — controllo di base
// ========================================
const inputWithoutDuplicates: readonly string[] = ["A", "B", "C", "D"]; // Input: [A, B, C, D]

const unique3 = uniqueStrings(inputWithoutDuplicates); // Chiamata funzione su array senza duplicati

assert.deepEqual(unique3, ["A", "B", "C", "D"], 
    "⛔ ERROR: Array senza duplicati non restituito correttamente"
);


// ========================================
// FUNZIONE UNIQUESTRINGS IMPLEMENTATA IN TypeScript
// ========================================

/**
 * ✅ uniqueStrings — Rimuove i duplicati mantenendo ordine originale
 * 
 * 📚 STRATEGIA (Passaggi pratici):
 * 1. Impostiamo un Set vuoto per tracciare elementi unici visti finora.
 * 2. Iteriamo su ogni elemento dell'input e lo aggiungiamo al Set se non è già presente.
 *    → Il Set filtrerà in automatico i duplicati.
 * 3. Convertiamo il Set in Array — mantiene l'ordine di inserizione (ES2015+).
 * 
 * 🎓 NOTA didattica: Il Set è ideale per identificare únic elementi, mentre Array.from()
 * permette di mantenere l'ordine originale perché non fa un sort ma converto direttamente.
 */
function uniqueStrings(input: readonly string[]): string[] {
    // Passo 1: Iniziamo con un Set vuoto — ogni elemento aggiunto sarà unico
    const seen = new Set<string>();

    // Passo 2: Iteriamo su tutto l'input e aggiungiamo elementi unici al Set
    for (const element of input) {
        // Se l'elemento non è ancora nel Set, lo aggiungiamo
        if (!seen.has(element)) {
            seen.add(element);
        }
        // Alternativamente: se già esiste → saltare il duplicato ignorable
    }

    // Passo 3: Converti il Set in Array — questo ripristina l'ordine originale di inserimento!
    const result = Array.from(seen) as string[];

    return result;
}

// ========================================
// ✅ Fine file — Esegui con: npx tsx scripts/opencode-agent-smoke-test.ts
// ========================================

console.log("3 test superati");

