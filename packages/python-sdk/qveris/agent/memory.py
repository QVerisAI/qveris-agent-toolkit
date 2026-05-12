import json
from typing import List, Dict, Any, Optional
from ..types import Message

def prune_tool_history(messages: List[Message], previous_messages_count: int) -> List[Message]:
    """
    Collapses old discovery results into concise summaries to save tokens.

    Args:
        messages: The full message history
        previous_messages_count: The number of previous messages to prune
    """
    # Map tool_call_id -> function_name from assistant messages
    tool_id_to_name = {}

    # First pass: Build map
    for msg in messages:
        if msg.role == 'assistant' and msg.tool_calls:
            for tc in msg.tool_calls:
                if tc.get('type') == 'function':
                     # Handle both dict and object access safely
                    func_name = tc.get('function', {}).get('name')
                    if not func_name:
                        continue
                    tool_id_to_name[tc['id']] = func_name

    new_messages = []
    for i, msg in enumerate(messages):
        if msg.role == 'tool' and msg.tool_call_id and i < previous_messages_count:
            tool_name = tool_id_to_name.get(msg.tool_call_id)

            if tool_name in {'discover', 'search_tools'} and msg.content:
                try:
                    content_obj = json.loads(msg.content)
                    # If it has 'results' array, it's the full uncompressed result
                    if isinstance(content_obj, dict) and 'results' in content_obj and isinstance(content_obj['results'], list):
                        # Create filtered content
                        tool_ids = [r.get('tool_id') or r.get('id') for r in content_obj['results']]
                        search_id = content_obj.get('search_id')

                        filtered_content = json.dumps({
                            "tool_ids": tool_ids,
                            "search_id": search_id
                        })

                        # Create new message with filtered content
                        new_msg = msg.model_copy()
                        new_msg.content = filtered_content
                        new_messages.append(new_msg)
                        continue
                except json.JSONDecodeError:
                    pass

        new_messages.append(msg)

    return new_messages
