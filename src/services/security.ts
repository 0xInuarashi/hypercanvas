import { streamChatCompletion, type StreamCallbacks } from './openrouter'

const SYSTEM_PROMPT = `You are a security analyst reviewing shell commands that a user is about to execute.
For each command:
1. Explain what it does in plain English
2. Flag any network activity, privilege escalation, file system writes, or persistence mechanisms
3. Rate risk: LOW / MEDIUM / HIGH / CRITICAL

End with a single verdict line:
VERDICT: <SAFE|CAUTION|DANGEROUS> - <one-line summary>`

export async function analyzeCommandSecurity(
  commands: string[],
  apiKey: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
) {
  const listing = commands
    .map((c, i) => `${i + 1}. \`${c}\``)
    .join('\n')

  await streamChatCompletion(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Review these commands:\n${listing}` },
    ],
    [],
    apiKey,
    callbacks,
    signal,
  )
}
