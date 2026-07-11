# QVeris CLI examples

Scripting patterns for the `qveris` CLI. Each script is safe to run without an
API key — it prints how to set one and exits — and the `call` step is gated
behind `RUN_QVERIS_CALLS=1` so no example spends credits by accident.

They assume `qveris` is on your `PATH` (`npm i -g @qverisai/cli`) and that `jq`
is installed. Override the binary with `QVERIS_BIN`, e.g.
`QVERIS_BIN="npx -y @qverisai/cli"`.

```bash
export QVERIS_API_KEY="sk-..."     # https://qveris.ai/account?page=api-keys
./discover-inspect-call.sh
MAX_COST=5 ./budget-guard.sh
```

## Scripts

| File | Shows |
|------|-------|
| [`discover-inspect-call.sh`](discover-inspect-call.sh) | The full discover → inspect → call → audit loop with `--json` + `jq` |
| [`budget-guard.sh`](budget-guard.sh) | Reading `expected_cost` and credit balance to refuse calls over budget |

For copy-paste workflow templates, see the [recipes](../../../recipes/), whose
flagship entries ship a runnable `run.sh`.
