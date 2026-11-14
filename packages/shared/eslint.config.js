import { defineConfig, globalIgnores } from 'eslint/config';
import { typeScriptConfig } from '../../eslint.base.js';

export default defineConfig([
  globalIgnores(['dist', 'eslint.config.js']),
  ...typeScriptConfig({ tsconfigRootDir: import.meta.dirname, globals: {} }),
]);
