import { printError } from 'obsidian-dev-utils/error';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { TokenEvaluatorContext } from '../token-evaluator-context.ts';

import { CustomToken } from './custom-token.ts';

type TokenEvaluator = ConstructorParameters<typeof CustomToken>[1];

vi.mock('obsidian-dev-utils/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian-dev-utils/error')>();
  return {
    ...actual,
    printError: vi.fn<typeof printError>()
  };
});

function createContext(format: TokenEvaluatorContext['format']): TokenEvaluatorContext {
  return strictProxy<TokenEvaluatorContext>({
    format
  });
}

afterEach(() => {
  vi.mocked(printError).mockReset();
});

describe('CustomToken', () => {
  it('should use the provided name', () => {
    const evaluator = vi.fn<TokenEvaluator>();
    const token = new CustomToken('myToken', evaluator);
    expect(token.name).toBe('myToken');
  });

  it('should delegate evaluation to the evaluator', async () => {
    const evaluator = vi.fn<TokenEvaluator>(() => 'evaluated');
    const token = new CustomToken('myToken', evaluator);
    const context = createContext({ extra: true });
    const result = await token.evaluate(context);
    expect(result).toBe('evaluated');
    expect(evaluator).toHaveBeenCalledWith(context);
  });

  it('should accept any loose format object', async () => {
    const evaluator = vi.fn<TokenEvaluator>(() => 'ok');
    const token = new CustomToken('myToken', evaluator);
    const result = await token.evaluate(createContext({ anything: 'goes', nested: { value: 1 } }));
    expect(result).toBe('ok');
  });
});

describe('CustomToken.parse', () => {
  it('should register the custom tokens declared in the string', async () => {
    const tokens = CustomToken.parse(`
      registerCustomToken('foo', () => 'fooValue');
      registerCustomToken('bar', () => 'barValue');
    `);

    expect(tokens).not.toBeNull();
    expect(tokens).toHaveLength(2);
    const [fooToken, barToken] = tokens ?? [];
    expect(fooToken?.name).toBe('foo');
    expect(barToken?.name).toBe('bar');
    expect(await fooToken?.evaluate(createContext(null))).toBe('fooValue');
    expect(await barToken?.evaluate(createContext(null))).toBe('barValue');
    expect(printError).not.toHaveBeenCalled();
  });

  it('should expose Md5 so user-level tokens can hash the attachment bytes', async () => {
    const tokens = CustomToken.parse(`
      registerCustomToken('file_md5', async (ctx) => {
        const content = await ctx.getAttachmentFileContent();
        if (content === undefined) return '';
        const hash = new Md5()
          .appendByteArray(new Uint8Array(content))
          .end();
        return hash.slice(0, ctx.format?.length ?? 32);
      });
    `);

    expect(tokens).not.toBeNull();
    expect(tokens).toHaveLength(1);
    const [fileMd5Token] = tokens ?? [];
    expect(fileMd5Token?.name).toBe('file_md5');

    const context = strictProxy<TokenEvaluatorContext>({
      format: null,
      getAttachmentFileContent: () => Promise.resolve(new TextEncoder().encode('hello').buffer)
    });
    expect(await fileMd5Token?.evaluate(context)).toBe('5d41402abc4b2a76b9719d911017c592');

    const shortContext = strictProxy<TokenEvaluatorContext>({
      format: { length: 8 },
      getAttachmentFileContent: () => Promise.resolve(new TextEncoder().encode('hello').buffer)
    });
    expect(await fileMd5Token?.evaluate(shortContext)).toBe('5d41402a');

    const emptyContext = strictProxy<TokenEvaluatorContext>({
      format: null,
      getAttachmentFileContent: () => Promise.resolve(undefined)
    });
    expect(await fileMd5Token?.evaluate(emptyContext)).toBe('');
    expect(printError).not.toHaveBeenCalled();
  });

  it('should return an empty array when no tokens are registered', () => {
    const tokens = CustomToken.parse('');
    expect(tokens).toEqual([]);
    expect(printError).not.toHaveBeenCalled();
  });

  it('should print the error and return null when registration throws', () => {
    const tokens = CustomToken.parse('this is not valid javascript (');
    expect(tokens).toBeNull();
    expect(printError).toHaveBeenCalledTimes(1);
    const [errorArgument] = vi.mocked(printError).mock.calls[0] ?? [];
    expect(errorArgument).toBeInstanceOf(Error);
    if (!(errorArgument instanceof Error)) {
      throw new Error('Expected the printed error to be an Error instance.');
    }
    expect(errorArgument.message).toBe('Error registering custom tokens');
    expect(errorArgument.cause).toBeInstanceOf(Error);
  });
});
