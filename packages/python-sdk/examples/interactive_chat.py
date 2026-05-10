import asyncio
import os
import sys
import json
from typing import List

# Add the project root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qveris import Agent, Message, QverisConfig
from qveris.llm.openai.config import OpenAIConfig
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.live import Live
from rich.text import Text
from rich.status import Status
from rich.theme import Theme

# Load .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Setup Rich Console
custom_theme = Theme({
    "info": "cyan",
    "warning": "yellow",
    "error": "red",
    "tool": "magenta",
    "reasoning": "dim italic blue",
    "user": "green bold",
    "assistant": "white"
})
console = Console(theme=custom_theme)

class LiveLineManager:
    def __init__(self, live: Live):
        self.live = live
        self.current_content = ""
        self.current_reasoning = ""

    def stop(self):
        self.live.stop()
        if (self.current_content):
            console.line()
        self.current_content = ""

    def restart(self):
        self.live.update("")
        self.live.start()

    def append_content(self, content: str):
        if not self.current_content and content:
            console.line()
        self.current_content += content
        self.live.update(Markdown(self.current_content))

    def append_reasoning(self, content: str):
        if not self.current_reasoning and content:
            console.line()
        self.current_reasoning += content
        self.live.update(Markdown(self.current_reasoning))


async def main():
    config = QverisConfig()
    openai_config = OpenAIConfig()
    
    # Check for debug mode
    debug_mode = os.getenv("DEBUG", "").lower() in ("1", "true", "yes")
    
    # Check keys
    if not config.api_key:
        console.print("[error]Please set QVERIS_API_KEY environment variable.[/error]")
        return
    if not openai_config.api_key: # Check OpenAI config
        console.print("[error]Please set OPENAI_API_KEY environment variable.[/error]")
        return

    # Setup debug callback if enabled
    debug_callback = None
    if debug_mode:
        def debug_print(message: str):
            console.print(f"[dim yellow][DEBUG][/dim yellow] {message}")
        debug_callback = debug_print

    agent = Agent(config=config, debug_callback=debug_callback)
    messages: List[Message] = []

    title = "[bold cyan]Qveris Interactive Agent[/bold cyan]"
    if debug_mode:
        title += " [dim yellow][DEBUG MODE][/dim yellow]"
    
    console.print(Panel.fit(
        f"{title}\n"
        f"Model: [bold white]{agent.agent_config.model}[/bold white]\n"
        "Type 'exit' or 'quit' to stop.",
        border_style="cyan"
    ))

    while True:
        try:
            user_input = console.input("\n[user]You > [/user]")
            if user_input.lower() in ('exit', 'quit'):
                break
                
            messages.append(Message(role="user", content=user_input))
            
            # State for live display
            # We use a Live display for the streaming content
            # Tool calls will be printed above/interleaved as they happen
            with Live("", refresh_per_second=10, console=console) as live:
                live_line = LiveLineManager(live)

                async for event in agent.run(messages):
                    
                    if event.type == "content":
                        live_line.append_content(event.content or "")
                        
                    elif event.type == "reasoning":
                        pass 

                    elif event.type == "reasoning_details":
                        pass

                    elif event.type == "tool_call":
                        live_line.stop()
                        
                        tool_name = event.tool_call['function']['name']
                        tool_args = event.tool_call['function']['arguments']
                        
                        # Shorten args for display
                        display_args = tool_args[:100] + "..." if len(tool_args) > 100 else tool_args
                        
                        console.print(f"[tool]→ Calling {tool_name}[/tool] [dim]({display_args})[/dim]")
                        
                        # In debug mode, show full arguments
                        if debug_mode:
                            try:
                                parsed_args = json.loads(tool_args)
                                console.print(f"[dim yellow][DEBUG] Full {tool_name} arguments:[/dim yellow]")
                                console.print(json.dumps(parsed_args, indent=2))
                            except:
                                console.print(f"[dim yellow][DEBUG] Raw arguments: {tool_args}[/dim yellow]")
                        
                        live_line.restart()

                    elif event.type == "tool_result":
                        live_line.stop()
                        
                        tr = event.tool_result
                        tool_name = tr.get("name", "unknown")
                        result = tr.get("result", {})
                        is_error = tr.get("is_error", False)
                        
                        if is_error:
                            console.print(f"[error]✗ {tool_name} failed:[/error] {result.get('error', 'Unknown error')}")
                        else:
                            # Summarize result
                            if tool_name == "search_tools":
                                total = result.get("total", 0)
                                tools = result.get("results", [])[:3]
                                tool_ids = [t.get("tool_id","?") for t in tools]
                                console.print(f"[info]✓ Found {total} tools:[/info] {', '.join(tool_ids)}{'...' if total > 3 else ''}")
                            elif tool_name == "execute_tool":
                                success = result.get("success", False)
                                if success:
                                    console.print(f"[info]✓ Tool executed successfully[/info]")
                                else:
                                    console.print(f"[warning]⚠ Tool returned: {str(result)[:200]}[/warning]")
                            else:
                                console.print(f"[info]✓ {tool_name} result:[/info] {str(result)[:200]}")
                        
                        live_line.restart()

                    elif event.type == "error":
                        live_line.stop()
                        console.print(f"[error]Error: {event.error}[/error]")
                        live_line.restart()

            # End of turn
            messages.append(Message(role="assistant", content=live_line.current_content))
            
        except (KeyboardInterrupt, EOFError, asyncio.CancelledError):
            console.print("\n[info]Goodbye![/info]")
            break


if __name__ == "__main__":
    # Check for rich
    try:
        import rich
    except ImportError:
        print("Please install rich: pip install rich")
        sys.exit(1)
        
    asyncio.run(main())
