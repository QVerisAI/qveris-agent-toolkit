const COMMANDS = [
  "discover", "inspect", "call",
  "login", "logout", "whoami", "credits",
  "config", "interactive", "history", "doctor", "completions",
];

export async function runCompletions(shell) {
  switch (shell) {
    case "bash":
      console.log(bashCompletions());
      break;
    case "zsh":
      console.log(zshCompletions());
      break;
    case "fish":
      console.log(fishCompletions());
      break;
    default:
      console.error(`  Supported shells: bash, zsh, fish`);
      console.error(`  Usage: eval "$(qveris completions bash)"`);
      process.exitCode = 2;
  }
}

function bashCompletions() {
  return `# bash completion for qveris
_qveris_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${COMMANDS.join(" ")}"
  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
  fi
}
complete -F _qveris_completions qveris`;
}

function zshCompletions() {
  return `# zsh completion for qveris
#compdef qveris

_qveris() {
  local -a commands
  commands=(
${COMMANDS.map((c) => `    '${c}:${c} command'`).join("\n")}
  )
  _arguments '1:command:->cmds' '*::arg:->args'
  case "$state" in
    cmds) _describe 'command' commands ;;
  esac
}
_qveris`;
}

function fishCompletions() {
  return COMMANDS.map(
    (c) => `complete -c qveris -n '__fish_use_subcommand' -a '${c}' -d '${c} command'`
  ).join("\n");
}
