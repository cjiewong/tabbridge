#!/usr/bin/env node
import { main } from '../lib/main.mjs';
main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ error: error.code || 'ERROR', message: error.message }) + '\n');
  process.exitCode = 1;
});
