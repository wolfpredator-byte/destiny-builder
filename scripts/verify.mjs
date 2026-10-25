/**
 * Verify Runner per Destiny Builder — H1-A
 * 
 * Questo script esegue verifiche automatizzate senza modificare le funzionalità
 * principali di Destiny Builder. Utilizza esclusivamente moduli integrati di Node.js
 * e npm (per npx).
 * 
 * Istruzioni didattiche in italiano:
 * - Verifica che tsx sia installato prima.
 * - Esegue typegen e tsc per generare file TypeScript necessari ai test.
 * - Esegue sequenzialmente TUTTI i file test-*.ts dalla radice.
 * - Registra tutti esiti in un report nel .next/.
 * 
 * Se qualcosa va storto, restituisce exit code diverso da zero e non nasconde errori.
 */

import assert from 'node:assert';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

