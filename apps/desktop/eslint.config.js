import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import { typeScriptConfig } from '../../eslint.base.js';

export default defineConfig([
  globalIgnores(['dist', 'out', 'coverage', 'eslint.config.js', 'scripts']),
  ...typeScriptConfig({
    tsconfigRootDir: import.meta.dirname,
    globals: globals.browser,
    allowDefaultProject: ['vite.config.ts', 'electron.vite.config.ts'],
  }),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },
  {
    files: ['electron/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // ** Radix stays behind the design-system wrappers so features share one set of focus and layering rules.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'radix-ui', message: 'Use the components/ui wrapper instead of importing Radix directly.' }] },
      ],
    },
  },
  {
    files: ['src/test/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
]);
