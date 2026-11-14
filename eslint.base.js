import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const NO_BARRELS = 'No barrel files: import from the module that defines the value instead of re-exporting it.';

/**
 * The TypeScript lint rules every workspace shares: strict type-checked rules, consistent type
 * imports and no barrel files. Each workspace adds its own globals and framework plugins.
 */
export function typeScriptConfig({ tsconfigRootDir, globals, allowDefaultProject = [] }) {
  return [
    {
      files: ['**/*.{ts,tsx}'],
      extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        ecmaVersion: 2023,
        globals,
        parserOptions: {
          projectService: { allowDefaultProject },
          tsconfigRootDir,
        },
      },
      rules: {
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        // ** Barrel files slow Vite's unbundled dev server and hinder tree shaking, so re-exports are banned.
        'no-restricted-syntax': [
          'error',
          { selector: 'ExportAllDeclaration', message: NO_BARRELS },
          { selector: 'ExportNamedDeclaration[source]', message: NO_BARRELS },
        ],
      },
    },
    {
      files: ['**/*.test.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
  ];
}
