import { EventEmitter } from 'node:events';
import type { Report } from './analyze.js';

/** Fired once per finished full check: the proof ledger and the bots listen here. */
export const events = new EventEmitter<{ report: [Report, number] }>();
events.setMaxListeners(20);
