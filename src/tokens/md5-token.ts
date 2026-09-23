import { Md5 } from 'ts-md5';
import { z } from 'zod';

import type { TokenEvaluatorContext } from '../token-evaluator-context.ts';

import { TokenBase } from './token-base.ts';

const formatSchema = z.strictObject({});
type Format = z.infer<typeof formatSchema>;

/**
 * The MD5 token — produces a 32-character lowercase hex digest of the attachment bytes.
 *
 * Used as `${md5}` in attachment file-name / file-path templates. The token exposes no
 * configuration: the digest is always the full MD5 hex of the attachment bytes, matching
 * the historic `0870a96 feat: md5` output byte-for-byte (verified against
 * `cef77564ca0bd02f39980938b52afbbe.jpeg`, a 214,688-byte JPEG whose existing filename
 * encodes its full MD5).
 *
 * When no attachment content is available (e.g. a template being evaluated before the
 * attachment exists on disk), falls back to a fresh UUID and warns once — the template
 * must still produce a valid file name.
 */
export class Md5Token extends TokenBase<Format> {
  public constructor() {
    super('md5', formatSchema);
  }

  protected override async evaluateImpl(context: TokenEvaluatorContext, _format: Format): Promise<string> {
    const content = await context.getAttachmentFileContent();
    if (content === undefined) {
      console.warn(`${Md5Token.name}: no attachment content available; falling back to a UUID. The generated file name will not be content-addressed.`);
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- crypto.randomUUID is the Web Crypto API, available in Obsidian's Electron renderer; the rule incorrectly flags it as a Node experimental builtin.
      return crypto.randomUUID();
    }
    // Ts-md5's `hashAsciiStr` consumes a latin1-encoded string where every char code equals
    // The corresponding byte. `Buffer.from(buffer).toString('latin1')` produces exactly that
    // Mapping for an `ArrayBuffer`, byte for byte, with no multi-byte UTF-8 reinterpretation.
    // Verified equivalent to Node `crypto.createHash('md5').update(buffer).digest('hex')`
    // Against the trading repo's existing attachment; do not change the encoding without
    // Re-running that equivalence check.
    return Md5.hashAsciiStr(Buffer.from(content).toString('latin1'));
  }
}
