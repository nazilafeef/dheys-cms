import data from './sites.example.json' with { type: 'json' };
import { parseRegistry, type Registry } from './lib/site-registry';

/**
 * Example site registry.
 *
 * Every site here is invented. This file exists so a forker can see the shape of a real
 * registry, run the admin against something, and copy a working definition — and for no
 * other reason. **The real registry never lives in this repository.** It loads at runtime
 * from a private gist, a private companion repository, or a repository secret; all three
 * are documented in docs/site-registry.md.
 *
 * The data lives in `sites.example.json` rather than in this file so that the same bytes
 * can be read by TypeScript, by a plain Node build script, and by an operator copying it
 * into their own storage. A second hand-maintained copy would drift.
 *
 * It is parsed rather than cast, so an invalid example fails at import — which is the
 * right moment, since this file is also the worked example the documentation points at.
 *
 * Copy it to your own storage, replace every value, and point `SITE_REGISTRY_SOURCE` at
 * it. Do not add a real site here, even temporarily: `pnpm check:clean-room` will fail the
 * build, which is the intended outcome.
 */
export const exampleRegistry: Registry = parseRegistry(JSON.stringify(data));

export default exampleRegistry;
