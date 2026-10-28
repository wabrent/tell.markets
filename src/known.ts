// Established assets that legitimately keep owner powers (minting, pausing, upgrades). Matched
// by address only: names are free to copy, so "• Robinhood Token" in a name proves nothing.
export const KNOWN_ASSETS: Record<string, string> = {
  '0x0bd7d308f8e1639fab988df18a8011f41eacad73': 'Wrapped Ether',
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 'Global Dollar (USDG) stablecoin',
  '0x117cc2133c37b721f49de2a7a74833232b3b4c0c': 'Robinhood stock token: SPY',
  '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec': 'Robinhood stock token: NVDA',
  '0x322f0929c4625ed5bad873c95208d54e1c003b2d': 'Robinhood stock token: TSLA',
  '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9': 'Robinhood stock token: AAPL',
  '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea': 'Robinhood stock token: SPCX',
};

export const knownAsset = (address: string) => KNOWN_ASSETS[address.toLowerCase()];
