import fs from 'fs';

export function assertNoRootLeak(leakPath: string, preExisted: boolean): void {
  const existsNow = fs.existsSync(leakPath);
  if (existsNow === preExisted) return;
  const verb = existsNow ? 'leaked' : 'was removed';
  throw new Error(
    `${leakPath} ${verb} during a test run; tests must use AWS_SIMULATOR_SESSIONS_DIR override`
  );
}
