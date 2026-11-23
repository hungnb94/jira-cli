export function fakeRun(respond) {
  const calls = [];
  const run = async (command, args, options = {}) => {
    const call = { command, args, input: options.input, timeout: options.timeout };
    calls.push(call);
    return { code: 0, stdout: '', ...(await respond(call)) };
  };
  return { run, calls };
}
