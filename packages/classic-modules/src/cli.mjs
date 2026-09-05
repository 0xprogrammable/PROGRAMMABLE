import { validateRecipe } from './index.mjs';
import { FILE_LIMITS, loadModulePackage, readJsonFile, writeJsonExclusive, submitToLocalQueue,
  listLocalQueue, localSubmissionStatus, recordLocalReview } from './io.mjs';

const HELP = `Local Classic Modules V1 tooling (no signing, deployment or public approval).

Commands:
  validate-module --manifest path
  validate-recipe --recipe path --catalogue path
  pack --manifest path --out path
  submit-local --manifest path --queue path
  list-local --queue path
  status-local --queue path --id 0x...
  review-local --queue path --id 0x... --reviewer 0x... --decision accepted|changes_requested|rejected --note text

All file paths are relative to --root (default: current directory).
Existing output files are never overwritten. Catalogue is an explicit trusted input.
Local reviewer identity is an operator assertion, not a wallet signature.
`;
const fields = {
  'validate-module': ['manifest'], 'validate-recipe': ['recipe', 'catalogue'], pack: ['manifest', 'out'],
  'submit-local': ['manifest', 'queue'], 'list-local': ['queue'], 'status-local': ['queue', 'id'],
  'review-local': ['queue', 'id', 'reviewer', 'decision', 'note'],
};
export async function runCli(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const [command, ...rest] = args;
    if (!command || command === '--help' || command === 'help') { stdout.write(HELP); return 0; }
    if (!fields[command]) throw new Error(`Unknown command: ${command}`);
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      const flag = rest[i]; const value = rest[i + 1];
      const key = flag?.startsWith('--') ? flag.slice(2) : '';
      if (!['root', ...fields[command]].includes(key) || !value || Object.hasOwn(options, key)) throw new Error(`Invalid or duplicate option: ${flag}`);
      options[key] = value;
    }
    for (const required of fields[command]) if (!options[required]) throw new Error(`Missing --${required}`);
    const root = options.root || process.cwd();
    let result;
    if (command === 'validate-module' || command === 'pack') {
      const pack = await loadModulePackage(root, options.manifest);
      if (command === 'pack' && !await writeJsonExclusive(root, options.out, pack)) throw new Error('Output exists; choose a new path');
      result = { ok: true, manifestHash: pack.manifestHash, reviewStatus: 'requested', runtimeVerified: false,
        ...(command === 'pack' ? { output: options.out } : {}) };
    } else if (command === 'validate-recipe') {
      const recipe = await readJsonFile(root, options.recipe, FILE_LIMITS.recipe);
      const catalogue = await readJsonFile(root, options.catalogue, FILE_LIMITS.catalogue);
      result = validateRecipe(recipe, catalogue);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`); return result.ok ? 0 : 1;
    } else if (command === 'submit-local') result = await submitToLocalQueue({ root, manifestPath: options.manifest, queue: options.queue });
    else if (command === 'list-local') result = await listLocalQueue({ root, queue: options.queue });
    else if (command === 'status-local') result = await localSubmissionStatus({ root, queue: options.queue, id: options.id });
    else result = await recordLocalReview({ root, ...options });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`); return 0;
  } catch (error) {
    stderr.write(`${JSON.stringify({ ok: false, errors: [{ code: error.code || 'CLI_ERROR', message: error.message }] })}\n`);
    return 1;
  }
}
