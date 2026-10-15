// Flat config (ESLint 9). Library lint: correctness rules only, no style rules (formatting is not enforced here).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'harness/**', 'examples/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // The kit depends on effect ordering. Each deliberate omission needs a disable comment with a reason.
      'react-hooks/exhaustive-deps': 'error',
      // The library logs only through src/platform/log.ts and the documented warn-once sites.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests spy on console and use loose rigs for mocked native modules.
    files: ['test/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
)
