import { getAddress, pad, zeroAddress, type Hex } from 'viem';
import { getTokensPairs } from '../sources/dexscreener.js';
import { fetchEventLogs, type Transfer } from '../sources/logs.js';
import { client, withBackoff } from '../sources/rpc.js';
import { short } from './contract.js';
import type { HolderFacts } from './holders.js';
import type { Check, TokenInfo } from './types.js';

export interface DeployerFacts {
  address?: Hex;
  launches?: number;
}

/**
 * The deployer is whoever sent the transaction that minted the supply. For launchpad tokens
 * that's the person who pressed "launch", not the factory contract.
 */
export async function checkDeployer(token: TokenInfo, transfers: Transfer[], holdersP: Promise<HolderFacts>): Promise<{ checks: Check[]; facts: DeployerFacts }> {
  const mint = transfers.find(t => t.from === zeroAddress);
  if (!mint) {
    return { checks: [{ group: 'deployer', status: 'info', title: 'Could not find the launch transaction', risk: 0 }], facts: {} };
  }

  const [tx, receipt] = await Promise.all([
    withBackoff(() => client.getTransaction({ hash: mint.tx })),
    withBackoff(() => client.getTransactionReceipt({ hash: mint.tx })),
  ]);
  const deployer = tx.from.toLowerCase() as Hex;
  // these don't need the holder map, so they run while it is being built
  const nonceP = withBackoff(() => client.getTransactionCount({ address: deployer })).catch(() => undefined);
  const historyP = launchHistory(receipt.logs, deployer, token.address).catch(() => undefined);
  const holders = await holdersP;
  const checks: Check[] = [{
    group: 'deployer', status: 'info', title: `Deployer ${short(deployer)}`,
    detail: tx.to ? `launched through ${short(tx.to)}` : 'deployed the contract directly', risk: 0,
  }];

  // How much the deployer holds now, and whether they dumped what they got
  const supply = token.totalSupply ?? 0n;
  const pct = (b: bigint) => (supply > 0n ? Number((b * 10_000n) / supply) / 100 : 0);
  const fmt = (b: bigint) => (b > 0n && pct(b) < 0.01 ? '<0.01' : String(pct(b)));
  const holding = holders.balances.get(deployer) ?? 0n;
  let received = 0n, soldToContracts = 0n;
  for (const t of transfers) {
    if (t.to.toLowerCase() === deployer) received += t.value;
    if (t.from.toLowerCase() === deployer && holders.contracts.has(t.to.toLowerCase())) soldToContracts += t.value;
  }
  const hp = pct(holding);
  if (holding > 0n) {
    checks.push({
      group: 'deployer', status: hp > 15 ? 'bad' : hp > 5 ? 'warn' : 'ok',
      title: `Deployer holds ${fmt(holding)}%`, risk: hp > 15 ? 25 : hp > 5 ? 10 : 0,
    });
  } else if (received > 0n && soldToContracts > 0n) {
    checks.push({
      group: 'deployer', status: 'warn', title: 'Deployer sold their whole bag',
      detail: `${pct(soldToContracts)}% of supply sold back into the pool`, risk: 15,
    });
  } else {
    checks.push({ group: 'deployer', status: 'ok', title: 'Deployer holds none of the supply', risk: 0 });
  }

  // Fresh wallets are cheap to throw away
  const nonce = await nonceP;
  if (nonce !== undefined && nonce < 5) {
    checks.push({ group: 'deployer', status: 'warn', title: `Fresh wallet: ${nonce} transaction${nonce === 1 ? '' : 's'} ever`, risk: 10 });
  }

  // Previous launches: find the factory's launch event in this receipt (the one that names both
  // the deployer and this token), then ask the factory for every such event by this deployer.
  const facts: DeployerFacts = { address: getAddress(deployer) };
  const history = await historyP;
  if (history && history.length > 1) {
    const others = history.filter(a => a.toLowerCase() !== token.address.toLowerCase());
    facts.launches = history.length;
    const pairs = await getTokensPairs(others.slice(0, 30)).catch(() => undefined);
    if (pairs) {
      const alive = new Set(pairs.filter(p => (p.liquidity?.usd ?? 0) >= 1_000).map(p => p.baseToken.address.toLowerCase()));
      const checked = Math.min(others.length, 30);
      const dead = others.slice(0, 30).filter(a => !alive.has(a.toLowerCase())).length;
      const ratio = dead / checked;
      checks.push({
        group: 'deployer',
        status: others.length >= 3 && ratio >= 0.7 ? 'bad' : others.length >= 10 ? 'warn' : 'info',
        title: `${others.length} earlier launch${others.length === 1 ? '' : 'es'}`,
        detail: `${dead} of ${checked} never held $1k of liquidity`,
        risk: others.length >= 3 && ratio >= 0.7 ? 25 : others.length >= 10 ? 10 : 0,
      });
    }
  } else if (history) {
    facts.launches = 1;
    checks.push({ group: 'deployer', status: 'ok', title: 'First launch from this wallet', risk: 0 });
  }

  return { checks, facts };
}

type Log = { address: Hex; topics: Hex[]; data: Hex };

async function launchHistory(logs: Log[], deployer: Hex, token: Hex): Promise<Hex[] | undefined> {
  const dTopic = pad(deployer).toLowerCase();
  const tWord = pad(token).toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() === token.toLowerCase() || !log.topics[0]) continue;
    const topics = log.topics.map(t => t.toLowerCase());
    const dIdx = topics.indexOf(dTopic);
    if (dIdx < 1) continue;

    // where does this event carry the token address: a topic, or a word of data?
    const tTopic = topics.indexOf(tWord);
    const words = (log.data.slice(2).match(/.{64}/g) ?? []).map(w => '0x' + w.toLowerCase());
    const tData = tTopic < 0 ? words.indexOf(tWord) : -1;
    if (tTopic < 0 && tData < 0) continue;

    const filter: (Hex | null)[] = [log.topics[0], null, null, null].slice(0, Math.max(dIdx + 1, 1)) as (Hex | null)[];
    filter[dIdx] = dTopic as Hex;
    const found = await fetchEventLogs(log.address, filter);
    return found.map(l => {
      const w = tTopic >= 0 ? l.topics[tTopic] : '0x' + l.data.slice(2 + tData * 64, 2 + (tData + 1) * 64);
      return getAddress('0x' + w.slice(-40));
    });
  }
  return undefined;
}
