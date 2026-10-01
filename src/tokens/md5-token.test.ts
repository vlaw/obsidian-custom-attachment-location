import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { TokenEvaluatorContext } from '../token-evaluator-context.ts';

import { Md5Token } from './md5-token.ts';

function createContext(
  content: ArrayBuffer | undefined,
  format: TokenEvaluatorContext['format'] = null,
  getAttachmentFileContent: () => Promise<ArrayBuffer | undefined> = () => Promise.resolve(content)
): TokenEvaluatorContext {
  return castTo<TokenEvaluatorContext>({
    format,
    getAttachmentFileContent
  });
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  if (hex.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function stringToArrayBuffer(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer;
}

describe('Md5Token', () => {
  it('should be named md5', () => {
    const token = new Md5Token();
    expect(token.name).toBe('md5');
  });

  it('should produce a 32-character lowercase hex hash of the attachment content', async () => {
    const token = new Md5Token();
    const result = await token.evaluate(createContext(stringToArrayBuffer('hello')));
    expect(result).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('should hash the canonical empty input', async () => {
    const token = new Md5Token();
    const result = await token.evaluate(createContext(stringToArrayBuffer('')));
    expect(result).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('should reject any non-empty format object — the token exposes no configuration', () => {
    const token = new Md5Token();
    const format = castTo<TokenEvaluatorContext['format']>({ case: 'upper', length: 8 });
    expect(() => token.evaluate(createContext(stringToArrayBuffer('hello'), format))).toThrow();
  });

  it('should call getAttachmentFileContent exactly once per evaluation', async () => {
    const token = new Md5Token();
    const getAttachmentFileContent = vi.fn<() => Promise<ArrayBuffer | undefined>>(() => Promise.resolve(stringToArrayBuffer('hello')));
    await token.evaluate(createContext(undefined, null, getAttachmentFileContent));
    expect(getAttachmentFileContent).toHaveBeenCalledOnce();
  });

  it('should fall back to a UUID and warn once when no attachment content is available', async () => {
    const token = new Md5Token();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const getAttachmentFileContent = vi.fn<() => Promise<ArrayBuffer | undefined>>(() => Promise.resolve(undefined));
    const result = await token.evaluate(createContext(undefined, null, getAttachmentFileContent));
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(getAttachmentFileContent).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('should reproduce the historic md5 byte-for-byte across implementations — guard against ts-md5 drift', async () => {
    // Fixture: the first 64 bytes of the trading repo's existing attachment file
    //   /Volumes/Source/code/github.com/vlaw/trading/assets/250717-173126/cef77564ca0bd02f39980938b52afbbe.jpeg
    // Whose full-file md5 is `cef77564ca0bd02f39980938b52afbbe`. The first 64 bytes of that file, hashed by
    // Both Node `crypto.createHash('md5')` and ts-md5 `Md5.hashAsciiStr(latin1-bytes)`, equal:
    //   841dac00b25fd23f976016396f5d3df9
    // If a future swap of `ts-md5` changes how it treats non-ASCII bytes (utf-8 vs latin1 vs byte-array),
    // This assertion fails and existing vault attachments would be renamed on next sync.
    const HEAD_HEX = 'ffd8ffe000104a46494600010100000100010000ffe201d84943435f50524f46494c45000101000001c800000000043000006d6e74725247422058595a2007e0';
    const token = new Md5Token();
    const result = await token.evaluate(createContext(hexToArrayBuffer(HEAD_HEX)));
    expect(result).toBe('841dac00b25fd23f976016396f5d3df9');
  });
});
