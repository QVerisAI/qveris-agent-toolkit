import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)

for (const locale of ["en-US", "zh-CN", "cn/zh-CN"]) {
  test(`${locale} onboarding keeps installation credentials private and supports outcome recovery`, async () => {
    const text = await fs.readFile(new URL(`docs/${locale}/getting-started.md`, root), "utf8")
    const setup = text.slice(text.indexOf("https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/agent/SETUP.md"))
    assert.doesNotMatch(setup, /along with your API key|连同你的 API 密钥/)
    assert.match(setup, /OAuth/)
    assert.match(setup, /secret store|密钥存储/)
    assert.match(setup, /Never paste API keys|不要将 API 密钥/)
    assert.match(text, /\]\(\/docs\/api-reference\/reconcile-call\)/)
    const shell = text.match(/```bash\r?\n([\s\S]*?)```/)?.[1]
    assert.match(shell, /npm install -g @qverisai\/cli/)
    assert.match(shell, /qveris auth login/)
    assert.match(shell, /qveris discover/)
    assert.doesNotMatch(shell, /qveris call|QVERIS_API_KEY=/)
  })
}

for (const file of ["README.md", "README_zh-CN.md", "agent/llms-full.txt"]) {
  test(`${file} installation prompts exclude credentials`, async () => {
    const text = await fs.readFile(new URL(file, root), "utf8")
    const prompts = text.split(/\r?\n/).filter(line => line.includes("Install QVeris skill following"))
    assert.ok(prompts.length > 0)
    for (const prompt of prompts) {
      assert.doesNotMatch(prompt, /QVERIS_API_KEY=|your-key|你的key/)
      assert.match(prompt, /Do not request or include credentials/)
    }
    assert.match(text, /secret store|密钥存储/)
  })
}

test("the setup protocol never requests a key from the conversation", async () => {
  const text = await fs.readFile(new URL("agent/SETUP.md", root), "utf8")
  assert.doesNotMatch(text, /API key the user provided|user did not provide an API key|document and a \*\*QVeris API key\*\*/)
  assert.match(text, /Never ask the user to paste API keys or claim codes into chat/)
  assert.match(text, /qveris auth login/)
  assert.match(text, /user must configure the secret privately/)
})
