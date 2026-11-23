const ENTER = new Set(['\r', '\n']);
const CTRL_C = '\u0003';
const BACKSPACE = new Set(['\u007f', '\b']);

export function promptHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return input.isTTY ? readFromTty(question, input, output) : readFirstLine(input);
}

function readFromTty(question, input, output) {
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk) => {
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

async function readFirstLine(input) {
  let data = '';
  for await (const chunk of input) {
    data += chunk;
    if (data.includes('\n')) break;
  }
  return data.split('\n')[0].trim();
}
