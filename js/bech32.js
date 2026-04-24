'use strict';

// ---- Bech32 decoder (npub -> hex) ----
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const result = [], maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; result.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) result.push((acc << (to - bits)) & maxv);
  return result;
}

function npubToHex(input) {
  input = input.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(input)) return input;

  const sepPos = input.lastIndexOf('1');
  if (sepPos < 1) throw new Error('無効な形式です');
  const hrp = input.slice(0, sepPos);
  if (hrp !== 'npub') throw new Error('npub で始まる公開鍵を入力してください');

  const data = [];
  for (let i = sepPos + 1; i < input.length; i++) {
    const d = BECH32_CHARSET.indexOf(input[i]);
    if (d === -1) throw new Error('無効な文字が含まれています');
    data.push(d);
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== 1) throw new Error('チェックサムエラー');
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  if (bytes.length !== 32) throw new Error('公開鍵の長さが不正です');
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function bech32Decode(str) {
  str = str.trim().toLowerCase();
  const sepPos = str.lastIndexOf('1');
  if (sepPos < 1) throw new Error('invalid');
  const hrp = str.slice(0, sepPos);
  const data = [];
  for (let i = sepPos + 1; i < str.length; i++) {
    const d = BECH32_CHARSET.indexOf(str[i]);
    if (d === -1) throw new Error('invalid char');
    data.push(d);
  }
  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  // bech32 (polymod=1) と bech32m (polymod=0x2bc830a3) の両方を受け付ける
  if (polymod !== 1 && polymod !== 0x2bc830a3) throw new Error('checksum');
  return { hrp, bytes: convertBits(data.slice(0, -6), 5, 8, false) };
}

function decodeMentionPubkey(ref) {
  const str = ref.replace(/^nostr:/i, '');
  const { hrp, bytes } = bech32Decode(str);
  if (hrp === 'npub') {
    if (bytes.length !== 32) throw new Error('bad length');
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  if (hrp === 'nprofile') {
    let i = 0;
    while (i + 1 < bytes.length) {
      const type = bytes[i++], len = bytes[i++];
      if (type === 0 && len === 32)
        return bytes.slice(i, i + 32).map(b => b.toString(16).padStart(2, '0')).join('');
      i += len;
    }
    throw new Error('no pubkey');
  }
  throw new Error('unsupported');
}

function nostrRefToHex(ref) {
  const str = ref.replace(/^nostr:/i, '');
  const { hrp, bytes } = bech32Decode(str);
  if (hrp === 'note') {
    if (bytes.length !== 32) throw new Error('bad length');
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  if (hrp === 'nevent') {
    let i = 0;
    while (i + 1 < bytes.length) {
      const type = bytes[i++], len = bytes[i++];
      if (type === 0 && len === 32)
        return bytes.slice(i, i + 32).map(b => b.toString(16).padStart(2, '0')).join('');
      i += len;
    }
    throw new Error('no id');
  }
  throw new Error('unsupported');
}

// nevent1 の TLV を全部デコードして { id, relays } を返す
function decodeNeventData(ref) {
  const str = ref.replace(/^nostr:/i, '');
  const { hrp, bytes } = bech32Decode(str);
  if (hrp !== 'nevent') throw new Error('not nevent');
  let id = null;
  const relays = [];
  let i = 0;
  while (i + 1 < bytes.length) {
    const type = bytes[i++], len = bytes[i++];
    if (type === 0 && len === 32) {
      id = bytes.slice(i, i + 32).map(b => b.toString(16).padStart(2, '0')).join('');
    } else if (type === 1) {
      // relay URL: UTF-8 bytes
      const chars = bytes.slice(i, i + len);
      relays.push(chars.map(b => String.fromCharCode(b)).join(''));
    }
    i += len;
  }
  if (!id) throw new Error('no id');
  return { id, relays };
}
