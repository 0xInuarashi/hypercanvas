/** Map file extension to Shiki language ID */
const EXT_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyw: 'python',
  go: 'go',
  rs: 'rust',
  json: 'json', jsonc: 'jsonc',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  md: 'markdown', mdx: 'mdx',
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  svelte: 'svelte', vue: 'vue',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  java: 'java', kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  zig: 'zig',
  lua: 'lua',
  dockerfile: 'dockerfile',
  xml: 'xml', svg: 'xml',
  graphql: 'graphql', gql: 'graphql',
  tf: 'hcl',
  prisma: 'prisma',
}

export function langFromPath(filePath: string): string {
  const name = filePath.split('/').pop() || ''
  const lower = name.toLowerCase()
  // Special filenames
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
  const ext = lower.includes('.') ? lower.split('.').pop()! : ''
  return EXT_MAP[ext] || 'plaintext'
}

/** Map language ID to LSP server command (for languages that have one) */
export const LSP_SERVERS: Record<string, { cmd: string[]; rootPatterns?: string[] }> = {
  typescript: { cmd: ['bunx', 'typescript-language-server', '--stdio'], rootPatterns: ['tsconfig.json', 'package.json'] },
  javascript: { cmd: ['bunx', 'typescript-language-server', '--stdio'], rootPatterns: ['package.json'] },
  tsx: { cmd: ['bunx', 'typescript-language-server', '--stdio'], rootPatterns: ['tsconfig.json', 'package.json'] },
  jsx: { cmd: ['bunx', 'typescript-language-server', '--stdio'], rootPatterns: ['package.json'] },
  python: { cmd: ['pylsp'], rootPatterns: ['pyproject.toml', 'setup.py'] },
  go: { cmd: ['gopls', 'serve'], rootPatterns: ['go.mod'] },
  rust: { cmd: ['rust-analyzer'], rootPatterns: ['Cargo.toml'] },
  svelte: { cmd: ['bunx', 'svelteserver', '--stdio'], rootPatterns: ['svelte.config.js', 'package.json'] },
  json: { cmd: ['bunx', 'vscode-json-language-server', '--stdio'] },
  yaml: { cmd: ['bunx', 'yaml-language-server', '--stdio'] },
}

/** Normalize language to LSP key (tsx/jsx share typescript server) */
export function lspKeyFromLang(lang: string): string | null {
  if (lang === 'tsx' || lang === 'jsx') return 'typescript'
  if (LSP_SERVERS[lang]) return lang
  return null
}
