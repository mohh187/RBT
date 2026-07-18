// Project lint: catches the two bug classes that bit us in production code —
// undefined identifiers (missing imports: the FloorMap useRef / Items `items`
// incidents) and React hooks violations. Run: npm run lint
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off', // deliberate: fx-fingerprint pattern used instead
    },
  },
  {
    files: ['functions/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error', 'no-dupe-keys': 'error' },
  },
]
