#!/usr/bin/env node
/**
 * LGNS 销毁统计（NFT 工厂 BurnNFTMinted 事件累加）
 * 输出 burn-stats.json，供网页直接读取（避免浏览器直接打区块浏览器 API 被拦/限流）
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, 'burn-stats.json');
const API = 'https://browser.anubispace.org/api';
const RPC = 'https://rpc.anubispace.org';
const FACT = '0xB39d8759d59592363395E4c66a3d4E4ACc9bc09D';
const T0 = '0xd67ccdfa9242c203ed59f133bb981c49f98478f702b1ea2fb54f54afe4966fb4';
const START = 14922281;
const CHUNK = 100000;
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function logs(from, to, attempt = 0) {
  const u = API + '?module=logs&action=getLogs&fromBlock=' + from + '&toBlock=' + to + '&address=' + FACT + '&topic0=' + T0;
  try {
    const r = await fetch(u, { headers: UA });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return Array.isArray(j.result) ? j.result : [];
  } catch (e) {
    if (attempt < 3) { console.warn('retry ' + from + ': ' + e.message); await sleep(1500); return logs(from, to, attempt + 1); }
    throw e;
  }
}

const main = async () => {
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  let nft = 0, lgns = 0, ailgns = 0, valueDai = 0, capacityDai = 0, failed = 0;
  const modes = {};
  for (let b = START; b <= head; b += CHUNK) {
    const to = Math.min(b + CHUNK - 1, head);
    let arr;
    try { arr = await logs(b, to); } catch (e) { failed++; console.warn('skip ' + b + ': ' + e.message); continue; }
    for (const x of arr) {
      const w = String(x.data).slice(2).match(/.{1,64}/g) || [];
      if (w.length < 9) continue;
      const mode = Number(BigInt('0x' + w[0]));
      modes[mode] = (modes[mode] || 0) + 1;
      lgns += Number(BigInt('0x' + w[3])) / 1e9;
      ailgns += Number(BigInt('0x' + w[4])) / 1e18;
      valueDai += Number(BigInt('0x' + w[7])) / 1e18;
      capacityDai += Number(BigInt('0x' + w[8])) / 1e18;
      nft++;
    }
    console.log('  ' + b + '~' + to + ' → ' + arr.length + ' 条（累计 NFT ' + nft + '）');
    await sleep(250);
  }
  const out = {
    updatedAt: new Date().toISOString(),
    block: head,
    factory: FACT,
    event: 'BurnNFTMinted',
    topic0: T0,
    nft,
    lgnsBurned: Number(lgns.toFixed(4)),
    ailgnsBurned: Number(ailgns.toFixed(6)),
    burnValueDai: Number(valueDai.toFixed(2)),
    capacityDai: Number(capacityDai.toFixed(2)),
    modes,
    failedChunks: failed,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log('[ok] ' + OUT);
  console.log('  NFT ' + nft + ' | 销毁 LGNS ' + out.lgnsBurned.toFixed(2) + ' | 价值 ' + out.burnValueDai.toFixed(2) + ' DAI');
};

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
