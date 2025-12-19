import asyncio
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from qveris import Agent, Message, QverisConfig, AgentConfig

from rich.theme import Theme

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Setup Rich Console with same theme as interactive_chat.py
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

# OpenRouter model names
GPT_MODEL = "openai/gpt-5.2"
GEMINI_MODEL = "google/gemini-3-pro-preview"

MAX_ROUNDS = 10


def print_agent_response(agent_name: str, model: str, content: str, color: str, round_num: int):
    """Display agent response in a styled panel."""
    title = f"[bold]{agent_name}[/bold] ({model}) - Round {round_num}"
    panel = Panel(
        Text(content or "(No response)"),
        title=title,
        border_style=color,
        padding=(1, 2)
    )
    console.print(panel)
    console.print()


async def run_agent_turn(agent: Agent, messages: list[Message], agent_name: str, color: str) -> str:
    """
    Run a single agent turn using NON-STREAMING via unified run() API.
    Returns final content. Tool calls are displayed as they occur.
    """
    final_content = ""
    
    async for event in agent.run(messages, stream=False):
        if event.type == "content" and event.content:
            final_content = event.content  # Non-streaming: full content in one piece
            
        elif event.type == "tool_call" and event.tool_call:
            tool_name = event.tool_call['function']['name']
            tool_args = event.tool_call['function']['arguments']
            
            # Shorten args for display
            display_args = tool_args[:100] + "..." if len(tool_args) > 100 else tool_args
            console.print(f"[tool]→ {agent_name} calling {tool_name}[/tool] [dim]({display_args})[/dim]")
            
        elif event.type == "tool_result" and event.tool_result:
            tr = event.tool_result
            tool_name = tr.get("name", "unknown")
            result = tr.get("result", {})
            is_error = tr.get("is_error", False)
            
            if is_error:
                console.print(f"[error]✗ {tool_name} failed:[/error] {result.get('error', 'Unknown error')}")
            else:
                # Summarize result similar to interactive_chat.py
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
            
        elif event.type == "error" and event.error:
            console.print(f"[error]Error: {event.error}[/error]")
    
    return final_content


async def main():
    console.print(Panel.fit(
        "[bold cyan]NVIDIA Stock Analysis Debate[/bold cyan]\n"
        f"[dim]GPT-5.2 vs Gemini-3-Pro • Max {MAX_ROUNDS} rounds[/dim]",
        border_style="cyan"
    ))
    console.print()

    config = QverisConfig()

    # Agent 1: GPT-5.2
    agent_gpt = Agent(
        config=config,
        agent_config=AgentConfig(
            model=GPT_MODEL,
            temperature=0.7,
            additional_system_prompt=(
                "You are a stock market analyst participating in a debate about NVIDIA stock. "
                "Use search tools to find real-time data and news. "
                "Be analytical, cite sources, and make clear arguments. "
                "Keep responses concise (2-3 paragraphs max). "
                "Maximum 1 search_tools call and 1 execute_tool call per round."
                "End with a clear stance: BULLISH or BEARISH for the next 24 hours."
            )
        )
    )

    # Agent 2: Gemini-3-Pro
    agent_gemini = Agent(
        config=config,
        agent_config=AgentConfig(
            model=GEMINI_MODEL,
            temperature=0.7,
            additional_system_prompt=(
                "You are a stock market analyst participating in a debate about NVIDIA stock. "
                "Use search tools to find real-time data and news. "
                "Be analytical, cite sources, and challenge the other analyst's arguments. "
                "Keep responses concise (2-3 paragraphs max). "
                "Maximum 1 search_tools call and 1 execute_tool call per round."
                "End with a clear stance: BULLISH or BEARISH for the next 24 hours."
            )
        )
    )

    # Initial prompt
    debate_topic = (
        "Analyze whether NVIDIA's stock price will go UP or DOWN in the next 24 hours. "
        "Search for the latest NVIDIA news, stock data, and market sentiment. "
        "Present your analysis and take a clear position."
    )

    # Conversation history (shared between agents)
    conversation = [
        Message(role="user", content=f"DEBATE TOPIC: {debate_topic}\n\nYou are the first analyst. Please begin.")
    ]

    round_num = 0
    current_agent = "gpt"

    while round_num < MAX_ROUNDS:
        if current_agent == "gpt":
            agent = agent_gpt
            agent_name = "GPT-5.2"
            model = GPT_MODEL
            color = "blue"
            other_name = "Gemini-3-Pro"
        else:
            agent = agent_gemini
            agent_name = "Gemini-3-Pro"
            model = GEMINI_MODEL
            color = "magenta"
            other_name = "GPT-5.2"

        console.print(f"[dim]Running {agent_name}...[/dim]")
        
        # Run the agent turn (non-streaming)
        response_content = await run_agent_turn(agent, conversation, agent_name, color)

        # Only count as a round if there's actual content
        if response_content and response_content.strip():
            round_num += 1
            print_agent_response(agent_name, model, response_content, color, round_num)

            # Add response to conversation
            conversation.append(Message(role="assistant", content=f"[{agent_name}]: {response_content}"))

            # Prepare prompt for next agent
            if round_num < MAX_ROUNDS:
                conversation.append(Message(
                    role="user",
                    content=f"[Moderator]: {other_name}, please respond to {agent_name}'s analysis."
                ))

            # Switch agents
            current_agent = "gemini" if current_agent == "gpt" else "gpt"
        else:
            console.print(f"[dim]{agent_name} is gathering data...[/dim]")

    # Final summary
    console.print()
    console.print(Panel.fit(
        f"[bold green]Debate Complete![/bold green]\n"
        f"[dim]Total rounds: {round_num}[/dim]",
        border_style="green"
    ))


if __name__ == "__main__":
    asyncio.run(main())
