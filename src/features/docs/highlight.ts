import "server-only"

import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

/**
 * Syntax highlighting, server-side only. The page is statically rendered, so
 * Shiki runs at build time and ships zero JavaScript to the browser.
 *
 * Fine-grained imports keep it small: the JavaScript regex engine (no WASM),
 * six grammars, and a theme whose colours are CSS variables
 * (`--shiki-token-*` in src/design/tokens.css) — so highlighting follows the
 * light/dark tokens like everything else instead of shipping two themes.
 */
export type CodeLanguage = "html" | "javascript" | "typescript" | "json" | "bash" | "shell" | "text"

const theme = createCssVariablesTheme({ name: "refvia", variablePrefix: "--shiki-", fontStyle: true })

let highlighter: Promise<HighlighterCore> | null = null

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [theme],
    langs: [
      import("shiki/langs/html.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/bash.mjs"),
    ],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighter
}

export async function highlight(code: string, language: CodeLanguage): Promise<ThemedToken[][]> {
  if (language === "text") {
    return code.split("\n").map((line) => [{ content: line, offset: 0 } as ThemedToken])
  }
  const instance = await getHighlighter()
  // A shell command and a cURL call share the bash grammar; only the label differs.
  const lang = language === "shell" ? "bash" : language
  return instance.codeToTokensBase(code, { lang, theme: "refvia" })
}
