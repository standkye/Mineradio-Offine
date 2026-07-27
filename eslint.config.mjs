// ESLint Flat Config — 针对 Mineradio 旧风格 JS 的宽松规则
export default [
  {
    ignores: [
      'dist/',
      'node_modules/',
      'public/vendor/',
      'public/index.html',
      'public/desktop-lyrics.html',
      'public/wallpaper.html',
      'public/sonic-topography-preset.js',
      'public/default-user-fx-archive.json',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        // Browser
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        AudioContext: 'readonly',
        OffscreenCanvas: 'readonly',
        Image: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLElement: 'readonly',
        CustomEvent: 'readonly',
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        // Node.js
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        exports: 'readonly',
        console: 'readonly',
        URLSearchParams: 'readonly',
        setImmediate: 'readonly',
        // Electron / IPC
        ipcRenderer: 'readonly',
        desktopWindow: 'readonly',
      },
    },
    rules: {
      // 错误预防 — 保留
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-extra-semi': 'warn',
      'no-cond-assign': ['warn', 'except-parens'],
      'valid-typeof': 'error',

      // 宽松规则 — 适应旧代码风格
      'no-var': 'off',
      'prefer-const': 'off',
      'no-unused-vars': ['warn', {
        args: 'none',
        vars: 'local',
        ignoreRestSiblings: true,
        caughtErrors: 'none',
      }],

      // 不需要的规则 — 关闭
      'no-redeclare': 'off',        // var 可重复声明
      'no-empty': 'off',            // 大量空 catch
      'no-control-regex': 'off',    // 音频分析需要控制字符
      'no-prototype-builtins': 'off',
      'no-useless-catch': 'off',
      'no-async-promise-executor': 'off',
    },
  },
  {
    files: ['server.js', 'dj-analyzer.js'],
    languageOptions: {
      sourceType: 'script',
    },
    rules: {
      'no-unused-vars': ['warn', {
        args: 'none',
        vars: 'local',
        caughtErrors: 'none',
      }],
    },
  },
];
