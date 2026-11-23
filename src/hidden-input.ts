export interface PromptStreams {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WritableStream;
}

const ENTER = new Set(['\r', '\n']);
const CTRL_C = '\u0003';
const BACKSPACE = new Set(['\u007f', '\b']);

export function promptHidden(
  question: string,
  { input = process.stdin, output = process.stderr }: PromptStreams = {},
): Promise<string> {
  if (input.isTTY) return readFromTty(question, input, output);
  output.write('stdin is not a terminal; reading the token from the first line of stdin\n');
  return readFirstLine(input);
}

function readFromTty(question: string, input: NodeJS.ReadStream, output: NodeJS.WritableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error): void => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ENTER.has(ch)) return finish();
        if (ch === CTRL_C) return finish(new Error('Cancelled'));
        if (BACKSPACE.has(ch)) value = value.slice(0, -1);
        else value += ch;
      }
    };
    output.write(question);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.resume();
  });
}

async function readFirstLine(input: NodeJS.ReadStream): Promise<string> {
  let data = '';
  for await (const chunk of input) {
    data += chunk;
    if (data.includes('\n')) break;
  }
  return (data.split('\n')[0] ?? '').trim();
}
