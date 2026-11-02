'use strict';
/* Loads the SAME Sudoku engine that ships in the client (site/index.html) into a Node vm
   so puzzles generated / validated on the server use identical rules and grading. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const START = 'var PUZZLE_BANK';
const END = '/* ===================== 17. SETTINGS & LOCALIZATION';

function load(htmlPath) {
  const file = htmlPath || path.join(__dirname, '..', 'site', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const s = html.indexOf(START), e = html.indexOf(END);
  if (s < 0 || e < 0 || e <= s) throw new Error('Engine markers not found in ' + file);
  const ctx = { setTimeout, clearTimeout, console, Math, Date, Promise, Uint8Array, Uint16Array, Uint32Array, Int32Array, Array, Object, JSON };
  vm.createContext(ctx);
  vm.runInContext(html.slice(s, e) + '\n;this.Engine=Engine;this.Logic=Logic;this.Generator=Generator;', ctx, { filename: 'engine.vm.js' });
  return { E: ctx.Engine, L: ctx.Logic, G: ctx.Generator };
}

module.exports = { load };
