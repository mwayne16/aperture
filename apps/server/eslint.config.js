import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { typeScriptConfig } from '../../eslint.base.js';

export default defineConfig([
  globalIgnores(['dist', 'eslint.config.js', 'scripts']),
  ...typeScriptConfig({ tsconfigRootDir: import.meta.dirname, globals: globals.node }),
]);
