// One-off probe: what USDG on Robinhood Chain supports (EIP-3009 / EIP-2612 / Permit2).
import { createPublicClient, http, parseAbi, toFunctionSelector, keccak256, toHex } from 'viem';

const c = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com') });
const USDG = process.argv[2] || '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const abi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)', 'function DOMAIN_SEPARATOR() view returns (bytes32)', 'function version() view returns (string)',
  'function authorizationState(address,bytes32) view returns (bool)', 'function nonces(address) view returns (uint256)',
  'function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])',
]);
const r = async (fn, args = []) => c.readContract({ address: USDG, abi, functionName: fn, args }).then(v => v, e => 'ERR ' + (e.shortMessage || e.message).split('\n')[0]);
console.log('chain', await c.getChainId());
for (const f of ['name', 'symbol', 'decimals', 'totalSupply', 'DOMAIN_SEPARATOR', 'version', 'eip712Domain']) console.log(f, await r(f));
console.log('authorizationState', await r('authorizationState', ['0x0000000000000000000000000000000000000001', '0x' + '00'.repeat(32)]));
console.log('nonces', await r('nonces', ['0x0000000000000000000000000000000000000001']));
const code = await c.getCode({ address: USDG });
const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const impl = await c.getStorageAt({ address: USDG, slot });
console.log('code bytes', (code.length - 2) / 2, 'impl', impl);
let scan = code;
if (impl && BigInt(impl) !== 0n) scan = await c.getCode({ address: '0x' + impl.slice(-40) });
for (const s of ['transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
  'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
  'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)',
  'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)']) {
  console.log(s.split('(')[0], s.includes('bytes)') ? '(bytes sig)' : '', scan.toLowerCase().includes('63' + toFunctionSelector('function ' + s).slice(2)));
}
const p2 = await c.getCode({ address: PERMIT2 });
console.log('permit2 deployed', p2 && p2 !== '0x', p2 ? (p2.length - 2) / 2 : 0);
console.log('block', await c.getBlockNumber());
