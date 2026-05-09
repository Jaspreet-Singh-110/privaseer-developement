/**
 * Stryker-Vite Sourcemap Shim
 * 
 * This setup file runs ONLY when STRYKER_MUTATION=1 is set.
 * It creates empty sourcemap files to prevent Vite from attempting to load
 * missing .map files for Stryker's generated setup chunks in the sandbox.
 * 
 * Background: Stryker generates stryker-setup-*.js files dynamically, and Vite
 * tries to load corresponding .map files that don't exist, causing ENOENT errors
 * that crash the test runner.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

if (process.env.STRYKER_MUTATION === '1') {
  try {
    const cwd = process.cwd();
    const emptyMap = JSON.stringify({
      version: 3,
      sources: [],
      names: [],
      mappings: '',
    });
    
    // Write multiple map files to cover all possible Stryker setup file names
    const mapFiles = [
      'stryker-setup.js.map',
      'stryker-setup-0.js.map',
      'stryker-setup-1.js.map',
      'stryker-setup-2.js.map',
    ];
    
    for (const file of mapFiles) {
      try {
        writeFileSync(join(cwd, file), emptyMap, { encoding: 'utf8' });
      } catch {
        // Ignore write errors - best effort
      }
    }
    
    // Disable sourcemap environment variables as additional safeguard
    process.env.SOURCEMAP = 'false';
    process.env.VITE_SOURCEMAP = 'false';
  } catch {
    // Swallow errors to avoid breaking tests
  }
}

