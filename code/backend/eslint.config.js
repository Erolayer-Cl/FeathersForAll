// Lint del backend (gate de CI, S08). Mismas bases que code/frontend/eslint.config.js, sin React.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules', 'data', 'coverage'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
];
