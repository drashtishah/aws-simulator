import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { assertNoRootLeak } from './helpers/assert-no-root-leak';

const TMP = path.join(__dirname, '.tmp', `assert-no-root-leak-${process.pid}`);
fs.mkdirSync(TMP, { recursive: true });

after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

describe('assertNoRootLeak', () => {
  it('is silent when path did not pre-exist and does not exist now', () => {
    const p = path.join(TMP, 'absent-absent');
    assert.doesNotThrow(() => assertNoRootLeak(p, false));
  });

  it('is silent when path pre-existed and still exists', () => {
    const p = path.join(TMP, 'present-present');
    fs.mkdirSync(p, { recursive: true });
    assert.doesNotThrow(() => assertNoRootLeak(p, true));
  });

  it('throws when path did not pre-exist but exists now (leak)', () => {
    const p = path.join(TMP, 'absent-present');
    fs.mkdirSync(p, { recursive: true });
    assert.throws(
      () => assertNoRootLeak(p, false),
      /leaked/
    );
  });

  it('throws when path pre-existed but no longer exists (removed)', () => {
    const p = path.join(TMP, 'present-absent');
    assert.throws(
      () => assertNoRootLeak(p, true),
      /removed/
    );
  });
});
