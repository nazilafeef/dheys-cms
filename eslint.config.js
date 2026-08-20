import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import astroParser from 'astro-eslint-parser';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.astro/**',
      'coverage/**',
      'release/**',
      'test-results/**',
      'playwright-report/**',
      'public/_pagefind/**',
      '*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    /**
     * `files` is required here, not optional.
     *
     * A flat-config block with no `files` applies to every file, and its `languageOptions`
     * then overrides the parser that `astro.configs.recommended` set for `.astro`. The
     * symptom is a parse error on the first `type` import in Astro frontmatter, which reads
     * like a TypeScript problem and is actually a config-ordering one.
     */
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // The brief bans `any` outright. This is the enforcement, not a convention.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    /**
     * `consistent-type-imports` needs type information, and `astro-eslint-parser` does not
     * forward a TypeScript program. Applying it repo-wide crashes ESLint outright on the
     * first `.astro` file rather than reporting anything.
     *
     * It is scoped to `.ts`/`.tsx` instead, which is where it earns its keep: those are the
     * modules that get bundled, and a value import used only as a type is what drags a
     * runtime dependency into a bundle that did not need one. Astro frontmatter is compiled
     * away entirely, so the rule buys nothing there.
     */
    files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // Build/CI scripts are Node CLIs: they talk to the operator through stdout.
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', 'scripts/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    /**
     * Astro frontmatter is TypeScript, and `astro-eslint-parser` only parses it as such if
     * it is handed a TypeScript parser to delegate to. Without this, every `type` import
     * and every `interface Props` in a component is a parse error.
     */
    files: ['**/*.astro'],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.astro'],
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    rules: {
      // Astro components legitimately shadow `Props` and use frontmatter-scoped consts.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
