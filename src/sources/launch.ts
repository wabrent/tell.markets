import type { Hex } from 'viem';

export interface LaunchMeta {
  image?: string;
  description?: string;
  website?: string;
  socials: { type: string; url: string }[];
}

// ipfs.io and dweb.link rate-limit hard; Pinata's public gateway serves Pons images reliably
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

/**
 * Launchpads like Pons pass the token's metadata (image, description, links) as string arguments
 * of the launch call. Rather than tie this to one ABI, read every ABI-encoded string in the
 * calldata and sort them by what they look like.
 */
export function launchMeta(input: Hex): LaunchMeta | undefined {
  const strings = abiStrings(input);
  if (!strings.length) return undefined;

  const meta: LaunchMeta = { socials: [] };
  for (const s of strings) {
    const v = s.trim();
    if (/^ipfs:\/\//i.test(v)) { meta.image ??= IPFS_GATEWAY + v.replace(/^ipfs:\/\/(ipfs\/)?/i, ''); continue; }
    if (/^https?:\/\//i.test(v)) {
      let host = '';
      try { host = new URL(v).hostname.replace(/^www\./, '').toLowerCase(); } catch { continue; }
      if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(v) || /ipfs/.test(host)) meta.image ??= v;
      else if (host === 'x.com' || host === 'twitter.com') meta.socials.push({ type: 'twitter', url: v });
      else if (host === 't.me' || host === 'telegram.me') meta.socials.push({ type: 'telegram', url: v });
      else if (host.endsWith('discord.gg') || host.endsWith('discord.com')) meta.socials.push({ type: 'discord', url: v });
      else if (host === 'github.com') meta.socials.push({ type: 'github', url: v });
      else meta.website ??= v;
      continue;
    }
    // the description is the longest free-text argument
    if (v.includes(' ') && v.length > (meta.description?.length ?? 0)) meta.description = v.slice(0, 500);
  }
  return meta.image || meta.website || meta.description || meta.socials.length ? meta : undefined;
}

/** Every well-formed ABI string (length word, UTF-8 bytes, zero padding) in the calldata. */
function abiStrings(input: Hex): string[] {
  const buf = Buffer.from(input.slice(2), 'hex');
  const out: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  // arguments start after the 4-byte selector and are laid out in 32-byte words
  for (let at = 4; at + 64 <= buf.length; at += 32) {
    const word = buf.subarray(at, at + 32);
    if (word.subarray(0, 28).some(b => b !== 0)) continue;
    const len = word.readUInt32BE(28);
    if (len < 2 || len > 4000 || at + 32 + len > buf.length) continue;
    const bytes = buf.subarray(at + 32, at + 32 + len);
    const padEnd = at + 32 + Math.ceil(len / 32) * 32;
    if (padEnd > buf.length || buf.subarray(at + 32 + len, padEnd).some(b => b !== 0)) continue;
    let text: string;
    try { text = decoder.decode(bytes); } catch { continue; }
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) continue;
    out.push(text);
    at = padEnd - 32; // skip over the string body
  }
  return out;
}
