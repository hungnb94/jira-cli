import type { Run, RunOptions, RunResult } from '../../src/credential-store/types.js';

export interface RunCall {
  command: string;
  args: string[];
  input?: string;
  timeout?: number;
}

type Respond = (call: RunCall) => Partial<RunResult> | Promise<Partial<RunResult>>;

export function fakeRun(respond: Respond): { run: Run; calls: RunCall[] } {
  const calls: RunCall[] = [];
  const run: Run = async (command, args, options: RunOptions = {}) => {
    const call = { command, args, input: options.input, timeout: options.timeout };
    calls.push(call);
    return { code: 0, stdout: '', stderr: '', ...(await respond(call)) };
  };
  return { run, calls };
}
