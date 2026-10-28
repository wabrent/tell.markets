import { erc20Abi, parseAbi, toFunctionSelector, zeroAddress, type Hex } from 'viem';
import { client, errText, withBackoff } from '../sources/rpc.js';
import type { Check, TokenInfo } from './types.js';

const ownerAbi = parseAbi(['function owner() view returns (address)']);

// EIP-1967 implementation slot: keccak256('eip1967.proxy.implementation') - 1
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

// Functions that give the owner power over holders. Found by scanning the bytecode for their
// selectors, so this is a hint, not proof: a function can exist and still be harmless.
const DANGEROUS: { sig: string; title: string; risk: number; critical?: boolean }[] = [
  { sig: 'mint(address,uint256)', title: 'Owner can mint new tokens', risk: 30, critical: true },
  { sig: 'blacklist(address)', title: 'Owner can blacklist wallets', risk: 25 },
  { sig: 'setBlacklist(address,bool)', title: 'Owner can blacklist wallets', risk: 25 },
  { sig: 'addToBlacklist(address)', title: 'Owner can blacklist wallets', risk: 25 },
  { sig: 'pause()', title: 'Transfers can be paused', risk: 20 },
  { sig: 'setTaxes(uint256,uint256)', title: 'Taxes can be changed after launch', risk: 20 },
  { sig: 'setFees(uint256,uint256)', title: 'Fees can be changed after launch', risk: 20 },
  { sig: 'setSellFee(uint256)', title: 'Sell tax can be changed', risk: 20 },
  { sig: 'setMaxTxAmount(uint256)', title: 'Owner can cap trade size', risk: 10 },
];

export async function readToken(address: `0x${string}`): Promise<TokenInfo> {
  const base = { address, abi: erc20Abi } as const;
  const [name, symbol, decimals, totalSupply] = await Promise.allSettled([
    withBackoff(() => client.readContract({ ...base, functionName: 'name' })),
    withBackoff(() => client.readContract({ ...base, functionName: 'symbol' })),
    withBackoff(() => client.readContract({ ...base, functionName: 'decimals' })),
    withBackoff(() => client.readContract({ ...base, functionName: 'totalSupply' })),
  ]);
  const val = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
  return { address, name: val(name), symbol: val(symbol), decimals: val(decimals), totalSupply: val(totalSupply) };
}

export async function checkContract(token: TokenInfo): Promise<Check[]> {
  const checks: Check[] = [];
  const code = await withBackoff(() => client.getCode({ address: token.address }));

  if (!code || code === '0x') {
    return [{ group: 'contract', status: 'bad', title: 'No contract at this address', risk: 100, critical: true }];
  }
  if (token.totalSupply === undefined || token.symbol === undefined) {
    checks.push({ group: 'contract', status: 'bad', title: 'Not a standard ERC-20 token', risk: 40 });
  }

  // Proxy: the code can be swapped for anything later.
  const impl = await withBackoff(() => client.getStorageAt({ address: token.address, slot: IMPL_SLOT })).catch(() => undefined);
  let scanCode: Hex = code;
  if (impl && BigInt(impl) !== 0n) {
    checks.push({
      group: 'contract', status: 'warn', title: 'Upgradeable contract (proxy)',
      detail: 'the token code can be swapped after launch', risk: 25,
    });
    // The real functions live in the implementation, not in the proxy.
    const implCode = await withBackoff(() => client.getCode({ address: `0x${impl.slice(-40)}` })).catch(() => undefined);
    if (implCode) scanCode = implCode;
  }

  // Owner
  // a revert means "no owner() function"; a rate-limit error is retried, never read as "no owner"
  const owner = await withBackoff(() => client.readContract({ address: token.address, abi: ownerAbi, functionName: 'owner' }))
    .catch(e => {
      if (/too many requests|429/i.test(errText(e))) throw e;
      return undefined;
    });
  if (owner === undefined) {
    checks.push({ group: 'contract', status: 'ok', title: 'No owner', risk: 0 });
  } else if (owner === zeroAddress) {
    checks.push({ group: 'contract', status: 'ok', title: 'Ownership renounced', risk: 0 });
  } else {
    checks.push({
      group: 'contract', status: 'info', title: 'Contract has an owner',
      detail: short(owner), risk: 5,
    });
  }

  // Bytecode scan. Owner powers only matter while there is an owner.
  const found = new Set<string>();
  for (const f of DANGEROUS) {
    if (!hasSelector(scanCode, toFunctionSelector(`function ${f.sig}`)) || found.has(f.title)) continue;
    found.add(f.title);
    const ownerless = owner === undefined || owner === zeroAddress;
    checks.push({
      group: 'contract',
      status: ownerless ? 'info' : 'bad',
      title: f.title,
      detail: ownerless ? 'but there is no owner to call it' : 'the owner can call it at any time',
      risk: ownerless ? 0 : f.risk,
      critical: ownerless ? false : f.critical,
    });
  }
  if (found.size === 0) {
    checks.push({ group: 'contract', status: 'ok', title: 'No dangerous owner functions found', risk: 0 });
  }

  return checks;
}

/** PUSH4 <selector> is how the dispatcher compares the called function. */
function hasSelector(code: Hex, selector: Hex) {
  return code.toLowerCase().includes('63' + selector.slice(2).toLowerCase());
}

export function short(addr: string) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}
