let input = '';
for await (const chunk of process.stdin) input += chunk;
const payload = JSON.parse(input);
if (payload.stage === 'select') {
  const tool = payload.input?.discovery?.results?.[0];
  process.stdout.write(JSON.stringify({ tool_id: tool?.tool_id ?? null }));
} else if (payload.stage === 'parameterize') {
  process.stdout.write(JSON.stringify({ parameters: {} }));
} else {
  process.exitCode = 2;
}
