// Run a check from the terminal: npm run check -- <address or link>
import { analyze, resolveToken } from './analyze.js';
import { formatPlain } from './format.js';

const input = process.argv.slice(2).join(' ');
const address = await resolveToken(input);
if (!address) {
  console.error('No token address found. Example: npm run check -- 0x…');
  process.exit(1);
}
console.log(formatPlain(await analyze(address)));
