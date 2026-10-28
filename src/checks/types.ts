export type Status = 'ok' | 'warn' | 'bad' | 'info';

export type Group = 'contract' | 'holders' | 'deployer' | 'website' | 'market';

export interface Check {
  group: Group;
  status: Status;
  title: string;
  detail?: string;
  /** Risk points this check adds to the 0–100 score. */
  risk: number;
  /** A critical flag pushes the total score to at least 80. */
  critical?: boolean;
}

export interface TokenInfo {
  address: `0x${string}`;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: bigint;
}
