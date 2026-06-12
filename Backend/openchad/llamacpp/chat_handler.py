import sys
from typing import TYPE_CHECKING
from llama_cpp.llama_chat_format import Llava15ChatHandler
class Gemma3ChatHandler(Llava15ChatHandler):
    DEFAULT_SYSTEM_MESSAGE = "You are a helpful assistant."
    GEMMA3_BOI_TOKEN  = "<start_of_image>"
    GEMMA3_EOI_TOKEN = "<end_of_image>"
    GEMMA3_BOS_TOKEN = "<bos>"
    GEMMA3_EOS_TOKEN = "<eos>"
    CHAT_FORMAT = (
        "{% if messages[0]['role'] == 'system' %}"
        "{% set loop_messages = messages[1:] %}"
        "{% if messages[0]['content'] is string %}"
        "{% set first_user_prefix = messages[0]['content'] + '\n\n' %}"
        "{% else %}"
        "{% set first_user_prefix = messages[0]['content'][0]['text'] + '\n\n' %}"
        "{% endif %}"
        "{% else %}"
        "{% set loop_messages = messages %}"
        "{% set first_user_prefix = '' %}"
        "{% endif %}"
        "{% for message in loop_messages %}"
        "{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}"
        "{{ raise_exception(\"Conversation roles must alternate user/assistant/user/assistant/...\") }}"
        "{% endif %}"
        "{% if message['role'] == 'assistant' %}"
        "{% set role = 'model' %}"
        "{% else %}"
        "{% set role = message['role'] %}"
        "{% endif %}"
        "{{ '<start_of_turn>' + role + '\n' + (first_user_prefix if loop.first else '') }}"
        "{% if message['content'] is string %}"
        "{{ message['content'] | trim }}"
        "{% elif message['content'] is iterable %}"
        "{% for item in message['content'] %}"
        "{% if item['type'] == 'image_url' and item['image_url'] is string %}"
        "{{ '<start_of_image>' + item['image_url'] + '<end_of_image>' }}"
        "{% elif item['type'] == 'image_url' and item['image_url'] is mapping %}"
        "{{ '<start_of_image>' + item['image_url']['url'] + '<end_of_image>' }}"
        "{% elif item['type'] == 'text' %}"
        "{{ item['text'] | trim }}"
        "{% endif %}"
        "{% endfor %}"
        "{% else %}"
        "{{ raise_exception('Invalid content type') }}"
        "{% endif %}"
        "<end_of_turn>\n"
        "{% endfor %}"
        "{% if add_generation_prompt %}"
        "<start_of_turn>model\n"
        "{% endif %}"
    )
class GLM41VChatHandler(Llava15ChatHandler):
    GLM41V_EOS_TOKEN = "<|endoftext|>"
    GLM41V_PAD_TOKEN = "<|endoftext|>"
    GLM41V_IMAGE_START_TOKEN = "<|begin_of_image|>"
    GLM41V_IMAGE_END_TOKEN = "<|end_of_image|>"
    CHAT_FORMAT = (
        "[gMASK]<sop>\n"
        "{%- for msg in messages -%}"
            "{%- if msg.role == 'system' -%}"
                "<|system|>\n{{ msg.content }}{{ GLM41V_EOS_TOKEN }}"
            "{%- elif msg.role == 'user' -%}"
                "<|user|>\n"
                "{%- if msg.content is string -%}"
                    "{{ msg.content }}"
                "{%- else -%}"
                    "{%- for item in msg.content -%}"
                        "{%- if item.type == 'image_url' or 'image_url' in item -%}"
                            "<|begin_of_image|>"
                            "{%- if item.image_url is string -%}"
                                "{{- item.image_url -}}"
                            "{%- else -%}"
                                "{{- item.image_url.url -}}"
                            "{%- endif -%}"
                            "<|end_of_image|>"
                        "{%- elif item.type == 'text' -%}"
                            "{{ item.text }}"
                        "{%- endif -%}"
                    "{%- endfor -%}"
                "{%- endif -%}{{ GLM41V_EOS_TOKEN }}"
            "{%- elif msg.role == 'assistant' -%}"
                "{%- if msg.metadata -%}"
                    "<|assistant|>{{ msg.metadata }}\n{{ msg.content }}{{ GLM41V_EOS_TOKEN }}"
                "{%- else -%}"
                    "<|assistant|>\n{{ msg.content }}{{ GLM41V_EOS_TOKEN }}"
                "{%- endif -%}"
            "{%- endif -%}"
        "{%- endfor -%}"
        "{%- if add_generation_prompt -%}"
            "<|assistant|>\n"
        "{%- endif -%}"
    )
    def __call__(self, **kwargs):
        self.extra_template_arguments["GLM41V_EOS_TOKEN"] = self.GLM41V_EOS_TOKEN # type: ignore
        # https://huggingface.co/zai-org/GLM-4.1V-9B-Thinking/blob/main/generation_config.json
        stop_tokens = [self.GLM41V_EOS_TOKEN, "<|user|>", "<|observation|>", "</answer>"] # Stop token patch
        kwargs['stop'] = stop_tokens
        llama = kwargs['llama']
        # Clear state for multiple runs
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        # Clear any handler state
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        if self.verbose:
            messages = kwargs.get('messages', [])
            try:
                image_count = len(self.get_image_urls(messages))
                print(f"GLM4VChatHandler - Cleared state, processing {image_count} images", file=sys.stderr)
            except Exception:
                print(f"GLM4VChatHandler - Cleared state", file=sys.stderr)
        # Use parent implementation
        return super().__call__(**kwargs)
class KimiVLChatHandler(Llava15ChatHandler):
    # Support for Kimi-VL-A3B-Instruct
    # Format: <|im_user|>user<|im_middle|>...<|im_end|>
    CHAT_FORMAT = (
        "{%- for message in messages -%}"
            "{%- if loop.first and messages[0].role != 'system' -%}"
                "{{- '<|im_system|>system<|im_middle|>You are a helpful assistant<|im_end|>' -}}"
            "{%- endif -%}"
            "{%- if message.role == 'system' -%}"
                "{{- '<|im_system|>' -}}"
            "{%- elif message.role == 'user' -%}"
                "{{- '<|im_user|>' -}}"
            "{%- elif message.role == 'assistant' -%}"
                "{{- '<|im_assistant|>' -}}"
            "{%- endif -%}"
            "{{- message.role -}}"
            "{{- '<|im_middle|>' -}}"
            "{%- if message.content is string -%}"
                "{{- message.content -}}"
            "{%- else -%}"
                "{%- for content in message.content -%}"
                    "{%- if content.type == 'image' or 'image' in content or 'image_url' in content -%}"
                        "{{- '<|media_start|>image<|media_content|><|media_pad|><|media_end|>' -}}"
                    "{%- else -%}"
                        "{{- content.text -}}"
                    "{%- endif -%}"
                "{%- endfor -%}"
            "{%- endif -%}"
            "{{- '<|im_end|>' -}}"
        "{%- endfor -%}"
        "{%- if add_generation_prompt -%}"
            "{{- '<|im_assistant|>assistant<|im_middle|>' -}}"
        "{%- endif -%}"
    )
    def __call__(self, **kwargs):
        # Kimi-VL stop tokens
        kwargs['stop'] = ["<|im_end|>", "[EOS]"]
        llama = kwargs['llama']
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        # Clear any handler state
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        return super().__call__(**kwargs)
class MistralChatHandler(Llava15ChatHandler): # type: ignore
    # Support for Ministral-3, Mistral-Large-3, Devstral
    # Uses [INST] / [/INST] format with <s> and </s>
    CHAT_FORMAT = (
        "{{- bos_token -}}"
        "{%- for message in messages -%}"
            "{%- if message.role == 'user' -%}"
                "{{- '[INST] ' -}}"
                "{%- if message.content is string -%}"
                    "{{- message.content -}}"
                "{%- else -%}"
                    "{%- for item in message.content -%}"
                        "{%- if item.type == 'text' -%}"
                            "{{- item.text -}}"
                        "{%- elif item.type == 'image_url' or item.type == 'image' -%}"
                            "{{- '[IMG]' -}}" # Mistral Multimodal/Pixtral uses [IMG]
                        "{%- endif -%}"
                    "{%- endfor -%}"
                "{%- endif -%}"
                "{{- ' [/INST]' -}}"
            "{%- elif message.role == 'assistant' -%}"
                "{{- ' ' + message.content + eos_token -}}"
            "{%- elif message.role == 'system' -%}"
                # Mistral usually appends system to first [INST]
                "{{- '[INST] ' + message.content + '\n\n' -}}"
            "{%- endif -%}"
        "{%- endfor -%}"
        "{%- if add_generation_prompt -%}"
            "{{- ' ' -}}" # Prompt for assistant response
        "{%- endif -%}"
    )
    def __call__(self, **kwargs):
        # Mistral v3 stop tokens
        kwargs['stop'] = ["[/INST]", "</s>", "[INST]"]
        llama = kwargs['llama']
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        # Clear any handler state
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        # Add bos/eos tokens to context if not present
        if not hasattr(self, "extra_template_arguments"):
            self.extra_template_arguments = {}
        self.extra_template_arguments["bos_token"] = "<s>"
        self.extra_template_arguments["eos_token"] = "</s>"
        return super().__call__(**kwargs)
class SmolVLMChatHandler(Llava15ChatHandler): # type: ignore
    CHAT_FORMAT = (
        "{{- '<|im_start|>' -}}"
        "{%- for message in messages -%}"
            "{{- message.role | capitalize -}}"
            "{%- if message.content is iterable and message.content[0].type == 'image' -%}"
                "{{- ':' -}}"
            "{%- else -%}"
                "{{- ': ' -}}"
            "{%- endif -%}"
            "{%- if message.content is string -%}"
                "{{- message.content -}}"
            "{%- else -%}"
                "{%- for item in message.content -%}"
                    "{%- if item.type == 'text' -%}"
                        "{{- item.text -}}"
                    "{%- elif item.type == 'image_url' or item.type == 'image' -%}"
                        "{{- '<image>' -}}"
                    "{%- endif -%}"
                "{%- endfor -%}"
            "{%- endif -%}"
            "{{- '<end_of_utterance>\n' -}}"
        "{%- endfor -%}"
        "{%- if add_generation_prompt -%}"
            "{{- 'Assistant:' -}}"
        "{%- endif -%}"
    )
    def __call__(self, **kwargs):
        # SmolVLM EOS is <end_of_utterance>
        kwargs['stop'] = ["<end_of_utterance>", "User:", "Assistant:"]
        llama = kwargs['llama']
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        # Clear any handler state
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        return super().__call__(**kwargs)
class GLM46VChatHandler(Llava15ChatHandler):
    GLM46V_EOS_TOKEN = "<|endoftext|>"
    GLM46V_PAD_TOKEN = "<|endoftext|>"
    GLM46V_IMAGE_START_TOKEN = "<|begin_of_image|>"
    GLM46V_IMAGE_END_TOKEN = "<|end_of_image|>"
    CHAT_FORMAT = (
        "[gMASK]<sop>"
        "{%- if tools -%}"
            "<|system|>\n# Tools\n\nYou may call one or more functions to assist with the user query.\n"
            "You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n"
            "{%- for tool in tools -%}"
                "{{ tool | tojson(ensure_ascii=False) }}\n"
            "{%- endfor -%}"
            "</tools>\n\nFor each function call, output the function name and arguments within the following XML format:\n"
            "<tool_call>{function-name}\n<arg_key>{arg-key-1}</arg_key>\n<arg_value>{arg-value-1}</arg_value>\n...\n</tool_call>"
        "{%- endif -%}"
        "{%- for m in messages -%}"
            "{%- if m.role == 'system' -%}"
                "<|system|>\n{{ m.content }}"
            "{%- elif m.role == 'user' -%}"
                "<|user|>\n"
                "{%- if m.content is string -%}"
                    "{{ m.content }}"
                "{%- else -%}"
                    "{%- for item in m.content -%}"
                        "{%- if item.type == 'image_url' or 'image_url' in item -%}"
                            "<|begin_of_image|>"
                            "{%- if item.image_url is string -%}"
                                "{{- item.image_url -}}"
                            "{%- else -%}"
                                "{{- item.image_url.url -}}"
                            "{%- endif -%}"
                            "<|end_of_image|>"
                        "{%- elif item.type == 'text' -%}"
                            "{{ item.text }}"
                        "{%- endif -%}"
                    "{%- endfor -%}"
                "{%- endif -%}"
                # If enable_thinking is disabled, insert `/nothink` according to the source code logic.
                "{{ '/nothink' if not enable_thinking else '' }}"
            "{%- elif m.role == 'assistant' -%}"
                "<|assistant|>"
                "{%- if enable_thinking -%}"
                    "{%- set reasoning = m.reasoning_content if m.reasoning_content is string else '' -%}"
                    "\n<think>{{ reasoning.strip() }}</think>"
                "{%- else -%}"
                    "\n<think></think>"
                "{%- endif -%}"
                "{{ '\n' + m.content.strip() if m.content.strip() else '' }}"
            "{%- endif -%}"
            "{{ GLM46V_EOS_TOKEN }}"
        "{%- endfor -%}"
        "{%- if add_generation_prompt -%}"
            "<|assistant|>\n"
            "{{ '<think>' if enable_thinking else '<think></think>\n' }}"
        "{%- endif -%}"
    )
    def __init__(self, enable_thinking: bool = True, **kwargs):
        """
        GLM-4.6V Handler
        Parameters:
        - enable_thinking (bool): Whether to enable the model's think process. The default is True.
        """
        self.enable_thinking = enable_thinking
        super().__init__(**kwargs)
    def __call__(self, **kwargs):
        self.extra_template_arguments["enable_thinking"] = self.enable_thinking #type: ignore
        self.extra_template_arguments["GLM46V_EOS_TOKEN"] = self.GLM46V_EOS_TOKEN #type: ignore
        # https://huggingface.co/zai-org/GLM-4.6V-Flash/blob/main/generation_config.json
        kwargs['stop'] = [self.GLM46V_EOS_TOKEN, "<|user|>", "<|observation|>", "<|code_middle|>"] # Stop token patch
        llama = kwargs['llama']
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        if self.verbose:
            messages = kwargs.get('messages', [])
            try:
                image_count = len(self.get_image_urls(messages))
                print(f"GLM46VChatHandler(enable_thinking={self.enable_thinking}) - Processing {image_count} images", file=sys.stderr)
            except Exception:
                print(f"GLM46VChatHandler(enable_thinking={self.enable_thinking}) - Cleared state", file=sys.stderr)
        return super().__call__(**kwargs)
class Qwen3VLChatHandler(Llava15ChatHandler):
    CHAT_FORMAT = (
        "{{- '<|im_start|>system\n' -}}"
        "{%- if messages[0].content is string and messages[0].role == 'system' -%}"
            "{{- messages[0].content -}}"
        "{%- elif messages[0].role == 'system' -%}"
            "{%- if 'text' in messages[0].content -%}"
                "{{- messages[0].content.text -}}"
            "{%- else -%}"
                "{{- 'You are a helpful assistant.' -}}"
            "{%- endif -%}"
        "{%- endif -%}"
        "{%- if tools -%}"
            "{{- '\n\n' -}}"
            "{{- '# Tools\n\nYou may call one or more functions to assist with the user query.\n\nYou are provided with function signatures within <tools></tools> XML tags:\n<tools>' -}}"
            "{%- for tool in tools -%}"
                "{{- '\n' -}}"
                "{{- tool | tojson -}}"
            "{%- endfor -%}"
            "{{- '\n</tools>\n\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n<tool_call>\n{\"name\": <function-name>, \"arguments\": <arguments-json-object>}\n</tool_call>\n\nYou can also return a response for the user alongside a function call:\nRESPONSE FOR THE USER HERE\n<tool_call>\n{\"name\": <function-name>, \"arguments\": <arguments-json-object>}\n</tool_call>' -}}"
        "{%- endif -%}"
        "{{- '<|im_end|>\n' -}}"
        "{%- set image_count = namespace(value=0) -%}"
        #"{%- set video_count = namespace(value=0) -%}"
        "{%- for message in messages -%}"
            "{%- if message.role == 'tool' -%}"
                "{{- '<|im_start|>user\n<tool_response>\n' -}}"
            "{%- elif message.role != 'system' -%}"
                "{{- '<|im_start|>' + message.role + '\n' -}}"
            "{%- endif -%}"
            "{%- if message.content is string and message.role != 'system' -%}"
                "{{- message.content -}}"
            "{%- elif message.role != 'system' -%}"
                "{%- for content in message.content -%}"
                    "{%- if 'image_url' in content -%}"
                        "{%- set image_count.value = image_count.value + 1 -%}"
                        "{%- if add_vision_id -%}"
                            "{{- 'Picture ' -}}"
                            "{{- image_count.value | string -}}"
                            "{{- ': ' -}}"
                        "{%- endif -%}"
                        "{{- '<|vision_start|>' -}}"
                        "{%- if content.image_url is string -%}"
                            "{{- content.image_url -}}"
                        "{%- else -%}"
                            "{{- content.image_url.url -}}"
                        "{%- endif -%}"
                        "{{- '<|vision_end|>' -}}"
                    "{%- endif -%}"
                    # Video not supported yet
                    "{%- if 'text' in content -%}"
                        "{{- content.text -}}"
                    "{%- endif -%}"
                "{%- endfor -%}"
            "{%- endif -%}"
            "{%- if message.role == 'assistant' -%}"
                "{%- if message.tool_calls -%}"
                    "{%- for tool_call in message.tool_calls -%}"
                        "{%- if (loop.first and message.content) or (not loop.first) -%}"
                            "{{- '\n' -}}"
                        "{%- endif -%}"
                        "{%- if tool_call.function -%}"
                            "{%- set tool_call = tool_call.function -%}"
                        "{%- endif -%}"
                        "{{- '<tool_call>\n{\"name\": \"' + tool_call.name + '\", \"arguments\": ' -}}"
                        "{%- if tool_call.arguments is string -%}"
                            "{{- tool_call.arguments -}}"
                        "{%- else -%}"
                            "{{- tool_call.arguments | tojson -}}"
                        "{%- endif -%}"
                        "{{- '}\n</tool_call>' -}}"
                    "{%- endfor -%}"
                "{%- endif -%}"
            "{%- elif message.role == 'tool' -%}"
                "{{- '</tool_response>' -}}"
            "{%- endif -%}"
            "{%- if message.role != 'system' -%}"
                "{{- '<|im_end|>\n' -}}"
            "{%- endif -%}"
        "{%- endfor -%}"
        "{%- if add_generation_prompt -%}"
            "{{- '<|im_start|>assistant\n' -}}"
            "{%- if force_reasoning -%}"
                "{{- '<think>\n' -}}"
            "{%- endif -%}"
        "{%- endif -%}"
    )
    def __init__(
        self,
        force_reasoning: bool = False,
        add_vision_id: bool = True,
        image_min_tokens: int = -1,
        **kwargs,
    ):
        """
        Parameters:
        - force_reasoning (bool):
            - True: Force the reasoning in the model by adding <think> to the chat template.
            - False (default): Don't force the reasoning.
        - add_vision_id (bool):
            - True (default): Count all the images. Recommended for multi-image.
            - False: Doesn't count the images. Can save tokens with single-image.
        - image_min_tokens (int):
            It only takes effect when the value is greater than zero. the default value is -1 (i.e., using the default parameters in the model's preprocessor_config.json).
            Note: Qwen-VL models require at minimum 1024 image tokens to function correctly on bbox grounding tasks
        """
        self.force_reasoning = force_reasoning
        self.add_vision_id = add_vision_id
        self.image_min_tokens = image_min_tokens
        super().__init__(image_min_tokens=self.image_min_tokens, **kwargs) #type: ignore
    def __call__(self, **kwargs):
        self.extra_template_arguments["force_reasoning"] = self.force_reasoning #type: ignore
        self.extra_template_arguments["add_vision_id"] = self.add_vision_id #type: ignore
        llama = kwargs['llama']
        # Clear state for multiple runs
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        # Clear any handler state
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        if self.verbose:
            messages = kwargs.get('messages', [])
            try:
                image_count = len(self.get_image_urls(messages))
                print(f"Qwen3VLHandler(force_reasoning={self.force_reasoning}) - Cleared state, processing {image_count} images", file=sys.stderr)
            except Exception:
                print(f"Qwen3VLHandler(force_reasoning={self.force_reasoning}) - Cleared state", file=sys.stderr)
        # Use parent implementation
        return super().__call__(**kwargs)
class Qwen35ChatHandler(Llava15ChatHandler):
    CHAT_FORMAT = r"""{%- set image_count = namespace(value=0) %}
{%- set video_count = namespace(value=0) %}
{%- macro render_content(content, do_vision_count, is_system_content=false) %}
    {%- if content is string %}
        {{- content }}
    {%- elif content is iterable and content is not mapping %}
        {%- for item in content %}
            {%- if 'image' in item or 'image_url' in item or item.type == 'image' %}
                {%- if is_system_content %}
                    {{- raise_exception('System message cannot contain images.') }}
                {%- endif %}
                {%- if do_vision_count %}
                    {%- set image_count.value = image_count.value + 1 %}
                {%- endif %}
                {%- if add_vision_id %}
                    {{- 'Picture ' ~ image_count.value ~ ': ' }}
                {%- endif %}
                {{- '<|vision_start|><|image_pad|><|vision_end|>' }}
            {%- elif 'video' in item or item.type == 'video' %}
                {%- if is_system_content %}
                    {{- raise_exception('System message cannot contain videos.') }}
                {%- endif %}
                {%- if do_vision_count %}
                    {%- set video_count.value = video_count.value + 1 %}
                {%- endif %}
                {%- if add_vision_id %}
                    {{- 'Video ' ~ video_count.value ~ ': ' }}
                {%- endif %}
                {{- '<|vision_start|><|video_pad|><|vision_end|>' }}
            {%- elif 'text' in item %}
                {{- item.text }}
            {%- else %}
                {{- raise_exception('Unexpected item type in content.') }}
            {%- endif %}
        {%- endfor %}
    {%- elif content is none or content is undefined %}
        {{- '' }}
    {%- else %}
        {{- raise_exception('Unexpected content type.') }}
    {%- endif %}
{%- endmacro %}
{%- if not messages %}
    {{- raise_exception('No messages provided.') }}
{%- endif %}
{%- if tools and tools is iterable and tools is not mapping %}
    {{- '<|im_start|>system\n' }}
    {{- "# Tools\n\nYou have access to the following functions:\n\n<tools>" }}
    {%- for tool in tools %}
        {{- "\n" }}
        {{- tool | tojson }}
    {%- endfor %}
    {{- "\n</tools>" }}
    {{- '\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n- Required parameters MUST be specified\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls\n</IMPORTANT>' }}
    {%- if messages[0].role == 'system' %}
        {%- set content = render_content(messages[0].content, false, true)|trim %}
        {%- if content %}
            {{- '\n\n' + content }}
        {%- endif %}
    {%- endif %}
    {{- '<|im_end|>\n' }}
{%- else %}
    {%- if messages[0].role == 'system' %}
        {%- set content = render_content(messages[0].content, false, true)|trim %}
        {{- '<|im_start|>system\n' + content + '<|im_end|>\n' }}
    {%- endif %}
{%- endif %}
{%- set ns = namespace(multi_step_tool=true, last_query_index=messages|length - 1) %}
{%- for message in messages[::-1] %}
    {%- set index = (messages|length - 1) - loop.index0 %}
    {%- if ns.multi_step_tool and message.role == "user" %}
        {%- set content = render_content(message.content, false)|trim %}
        {%- if not(content.startswith('<tool_response>') and content.endswith('</tool_response>')) %}
            {%- set ns.multi_step_tool = false %}
            {%- set ns.last_query_index = index %}
        {%- endif %}
    {%- endif %}
{%- endfor %}
{%- if ns.multi_step_tool %}
    {{- raise_exception('No user query found in messages.') }}
{%- endif %}
{%- for message in messages %}
    {%- set content = render_content(message.content, true)|trim %}
    {%- if message.role == "system" %}
        {%- if not loop.first %}
            {{- raise_exception('System message must be at the beginning.') }}
        {%- endif %}
    {%- elif message.role == "user" %}
        {{- '<|im_start|>' + message.role + '\n' + content + '<|im_end|>' + '\n' }}
    {%- elif message.role == "assistant" %}
        {%- set reasoning_content = '' %}
        {%- if message.reasoning_content is string %}
            {%- set reasoning_content = message.reasoning_content %}
        {%- else %}
            {%- if '</think>' in content %}
                {%- set reasoning_content = content.split('</think>')[0].rstrip('\n').split('<think>')[-1].lstrip('\n') %}
                {%- set content = content.split('</think>')[-1].lstrip('\n') %}
            {%- endif %}
        {%- endif %}
        {%- set reasoning_content = reasoning_content|trim %}
        {%- if (preserve_thinking is defined and preserve_thinking is true) or (loop.index0 > ns.last_query_index) %}
            {{- '<|im_start|>' + message.role + '\n<think>\n' + reasoning_content + '\n</think>\n\n' + content }}
        {%- else %}
            {{- '<|im_start|>' + message.role + '\n' + content }}
        {%- endif %}
        {%- if message.tool_calls and message.tool_calls is iterable and message.tool_calls is not mapping %}
            {%- for tool_call in message.tool_calls %}
                {%- if tool_call.function is defined %}
                    {%- set tool_call = tool_call.function %}
                {%- endif %}
                {%- if loop.first %}
                    {%- if content|trim %}
                        {{- '\n\n<tool_call>\n<function=' + tool_call.name + '>\n' }}
                    {%- else %}
                        {{- '<tool_call>\n<function=' + tool_call.name + '>\n' }}
                    {%- endif %}
                {%- else %}
                    {{- '\n<tool_call>\n<function=' + tool_call.name + '>\n' }}
                {%- endif %}
                {%- if tool_call.arguments is defined %}
                    {%- for args_name, args_value in tool_call.arguments|items %}
                        {{- '<parameter=' + args_name + '>\n' }}
                        {%- set args_value = args_value | string if args_value is string else args_value | tojson | safe %}
                        {{- args_value }}
                        {{- '\n</parameter>\n' }}
                    {%- endfor %}
                {%- endif %}
                {{- '</function>\n</tool_call>' }}
            {%- endfor %}
        {%- endif %}
        {{- '<|im_end|>\n' }}
    {%- elif message.role == "tool" %}
        {%- if loop.previtem and loop.previtem.role != "tool" %}
            {{- '<|im_start|>user' }}
        {%- endif %}
        {{- '\n<tool_response>\n' }}
        {{- content }}
        {{- '\n</tool_response>' }}
        {%- if not loop.last and loop.nextitem.role != "tool" %}
            {{- '<|im_end|>\n' }}
        {%- elif loop.last %}
            {{- '<|im_end|>\n' }}
        {%- endif %}
    {%- else %}
        {{- raise_exception('Unexpected message role.') }}
    {%- endif %}
{%- endfor %}
{%- if add_generation_prompt %}
    {{- '<|im_start|>assistant\n' }}
    {%- if enable_thinking is defined and enable_thinking is false %}
        {{- '<think>\n\n</think>\n\n' }}
    {%- else %}
        {{- '<think>\n' }}
    {%- endif %}
{%- endif %}"""
    def __init__(
        self,
        add_vision_id: bool = True,
        preserve_thinking: bool = True,
        enable_thinking: bool = True,
        image_min_tokens: int = -1,
        **kwargs,
    ):
        self.add_vision_id = add_vision_id
        self.preserve_thinking = preserve_thinking
        self.enable_thinking = enable_thinking
        self.image_min_tokens = image_min_tokens
        super().__init__(image_min_tokens=self.image_min_tokens, **kwargs) #type: ignore
    def __call__(self, **kwargs):
        self.extra_template_arguments["add_vision_id"] = self.add_vision_id #type: ignore
        self.extra_template_arguments["preserve_thinking"] = self.preserve_thinking #type: ignore
        self.extra_template_arguments["enable_thinking"] = self.enable_thinking #type: ignore
        llama = kwargs['llama']
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        return super().__call__(**kwargs)
class Gemma4ChatHandler(Llava15ChatHandler):
    DEFAULT_SYSTEM_MESSAGE = "You are a helpful assistant."
    GEMMA4_BOS_TOKEN = "<bos>"
    GEMMA4_EOS_TOKEN = "<eos>"
    CHAT_FORMAT = r"""{%- macro format_parameters(properties, required, filter_keys=false) -%}
    {%- set standard_keys = ['description', 'type', 'properties', 'required', 'nullable'] -%}
    {%- set ns = namespace(found_first=false) -%}
    {%- for key, value in properties | dictsort -%}
        {%- set add_comma = false -%}
        {%- if not filter_keys or key not in standard_keys -%}
            {%- if ns.found_first %},{% endif -%}
            {%- set ns.found_first = true -%}
            {{ key }}:{
            {%- if value['description'] -%}
                description:<|"|>{{ value['description'] }}<|"|>
                {%- set add_comma = true -%}
            {%- endif -%}
            {%- if value['type'] | upper == 'STRING' -%}
                {%- if value['enum'] -%}
                    {%- if add_comma %},{%- else -%} {%- set add_comma = true -%} {% endif -%}
                    enum:{{ format_argument(value['enum']) }}
                {%- endif -%}
            {%- elif value['type'] | upper == 'ARRAY' -%}
                {%- if value['items'] is mapping and value['items'] -%}
                    {%- if add_comma %},{%- else -%} {%- set add_comma = true -%} {% endif -%}
                    items:{
                    {%- set ns_items = namespace(found_first=false) -%}
                    {%- for item_key, item_value in value['items'] | dictsort -%}
                        {%- if item_value is not none -%}
                            {%- if ns_items.found_first %},{% endif -%}
                            {%- set ns_items.found_first = true -%}
                            {%- if item_key == 'properties' -%}
                                properties:{
                                {%- if item_value is mapping -%}
                                    {{- format_parameters(item_value, value['items']['required'] | default([])) -}}
                                {%- endif -%}
                                }
                            {%- elif item_key == 'required' -%}
                                required:[
                                {%- for req_item in item_value -%}
                                    <|"|>{{- req_item -}}<|"|>
                                    {%- if not loop.last %},{% endif -%}
                                {%- endfor -%}
                                ]
                            {%- elif item_key == 'type' -%}
                                {%- if item_value is string -%}
                                    type:{{ format_argument(item_value | upper) }}
                                {%- else -%}
                                    type:{{ format_argument(item_value | map('upper') | list) }}
                                {%- endif -%}
                            {%- else -%}
                                {{ item_key }}:{{ format_argument(item_value) }}
                            {%- endif -%}
                        {%- endif -%}
                    {%- endfor -%}
                    }
                {%- endif -%}
            {%- endif -%}
            {%- if value['nullable'] %}
                {%- if add_comma %},{%- else -%} {%- set add_comma = true -%} {% endif -%}
                nullable:true
            {%- endif -%}
            {%- if value['type'] | upper == 'OBJECT' -%}
                {%- if value['properties'] is defined and value['properties'] is mapping -%}
                    {%- if add_comma %},{%- else -%} {%- set add_comma = true -%} {% endif -%}
                    properties:{
                    {{- format_parameters(value['properties'], value['required'] | default([])) -}}
                    }
                {%- elif value is mapping -%}
                    {%- if add_comma %},{%- else -%} {%- set add_comma = true -%} {% endif -%}
                    properties:{
                    {{- format_parameters(value, value['required'] | default([]), filter_keys=true) -}}
                    }
                {%- endif -%}
                {%- if value['required'] -%}
                    {%- if add_comma %},{%- else -%} {%- set add_comma = true -%} {% endif -%}
                    required:[
                    {%- for item in value['required'] | default([]) -%}
                        <|"|>{{- item -}}<|"|>
                        {%- if not loop.last %},{% endif -%}
                    {%- endfor -%}
                    ]
                {%- endif -%}
            {%- endif -%}
            {%- if add_comma %},{%- else -%} {%- set add_comma = true -%} {% endif -%}
            type:<|"|>{{ value['type'] | upper }}<|"|>}
        {%- endif -%}
    {%- endfor -%}
{%- endmacro -%}
{%- macro format_function_declaration(tool_data) -%}
    declaration:{{- tool_data['function']['name'] -}}{description:<|"|>{{- tool_data['function']['description'] -}}<|"|>
    {%- set params = tool_data['function']['parameters'] -%}
    {%- if params -%}
        ,parameters:{
        {%- if params['properties'] -%}
            properties:{ {{- format_parameters(params['properties'], params['required']) -}} },
        {%- endif -%}
        {%- if params['required'] -%}
            required:[
            {%- for item in params['required'] -%}
                <|"|>{{- item -}}<|"|>
                {{- ',' if not loop.last -}}
            {%- endfor -%}
            ],
        {%- endif -%}
        {%- if params['type'] -%}
            type:<|"|>{{- params['type'] | upper -}}<|"|>}
        {%- endif -%}
    {%- endif -%}
    {%- if 'response' in tool_data['function'] -%}
        {%- set response_declaration = tool_data['function']['response'] -%}
        ,response:{
        {%- if response_declaration['description'] -%}
            description:<|"|>{{- response_declaration['description'] -}}<|"|>,
        {%- endif -%}
        {%- if response_declaration['type'] | upper == 'OBJECT' -%}
            type:<|"|>{{- response_declaration['type'] | upper -}}<|"|>}
        {%- endif -%}
    {%- endif -%}
    }
{%- endmacro -%}
{%- macro format_argument(argument, escape_keys=True) -%}
    {%- if argument is string -%}
        {{- '<|"|>' + argument + '<|"|>' -}}
    {%- elif argument is boolean -%}
        {{- 'true' if argument else 'false' -}}
    {%- elif argument is mapping -%}
        {{- '{' -}}
        {%- set ns = namespace(found_first=false) -%}
        {%- for key, value in argument | dictsort -%}
            {%- if ns.found_first %},{% endif -%}
            {%- set ns.found_first = true -%}
            {%- if escape_keys -%}
                {{- '<|"|>' + key + '<|"|>' -}}
            {%- else -%}
                {{- key -}}
            {%- endif -%}
            :{{- format_argument(value, escape_keys=escape_keys) -}}
        {%- endfor -%}
        {{- '}' -}}
    {%- elif argument is sequence -%}
        {{- '[' -}}
        {%- for item in argument -%}
            {{- format_argument(item, escape_keys=escape_keys) -}}
            {%- if not loop.last %},{% endif -%}
        {%- endfor -%}
        {{- ']' -}}
    {%- else -%}
        {{- argument -}}
    {%- endif -%}
{%- endmacro -%}
{%- macro strip_thinking(text) -%}
    {%- set ns = namespace(result='') -%}
    {%- for part in text.split('<channel|>') -%}
        {%- if '<|channel>' in part -%}
            {%- set ns.result = ns.result + part.split('<|channel>')[0] -%}
        {%- else -%}
            {%- set ns.result = ns.result + part -%}
        {%- endif -%}
    {%- endfor -%}
    {{- ns.result | trim -}}
{%- endmacro -%}
{%- macro format_tool_response_block(tool_name, response) -%}
    {{- '<|tool_response>' -}}
    {%- if response is mapping -%}
        {{- 'response:' + tool_name + '{' -}}
        {%- for key, value in response | dictsort -%}
            {{- key -}}:{{- format_argument(value, escape_keys=False) -}}
            {%- if not loop.last %},{% endif -%}
        {%- endfor -%}
        {{- '}' -}}
    {%- else -%}
        {{- 'response:' + tool_name + '{value:' + format_argument(response, escape_keys=False) + '}' -}}
    {%- endif -%}
    {{- '<tool_response|>' -}}
{%- endmacro -%}
{%- set ns = namespace(prev_message_type=None) -%}
{%- set loop_messages = messages -%}
{{- bos_token -}}
{#- Handle System/Tool Definitions Block -#}
{%- if (enable_thinking is defined and enable_thinking) or tools or messages[0]['role'] in ['system', 'developer'] -%}
    {{- '<|turn>system\n' -}}
    {#- Inject Thinking token at the very top of the FIRST system turn -#}
    {%- if enable_thinking is defined and enable_thinking -%}
        {{- '<|think|>\n' -}}
        {%- set ns.prev_message_type = 'think' -%}
    {%- endif -%}
    {%- if messages[0]['role'] in ['system', 'developer'] -%}
        {%- if messages[0]['content'] is string -%}
            {{- messages[0]['content'] | trim -}}
        {%- elif messages[0]['content'] is sequence -%}
            {%- for item in messages[0]['content'] -%}
                {{- item['text'] | trim + ' '-}}
            {%- endfor -%}
        {%- endif -%}
        {%- set loop_messages = messages[1:] -%}
    {%- endif -%}
    {%- if tools -%}
        {%- for tool in tools %}
            {{- '<|tool>' -}}
            {{- format_function_declaration(tool) | trim -}}
            {{- '<tool|>' -}}
        {%- endfor %}
        {%- set ns.prev_message_type = 'tool' -%}
    {%- endif -%}
    {{- '<turn|>\n' -}}
{%- endif %}
{#- Pre-scan: find last user message index for reasoning guard -#}
{%- set ns_turn = namespace(last_user_idx=-1) -%}
{%- for i in range(loop_messages | length) -%}
    {%- if loop_messages[i]['role'] == 'user' -%}
        {%- set ns_turn.last_user_idx = i -%}
    {%- endif -%}
{%- endfor -%}
{#- Loop through messages -#}
{%- for message in loop_messages -%}
    {%- if message['role'] != 'tool' -%}
    {%- set ns.prev_message_type = None -%}
    {%- set role = 'model' if message['role'] == 'assistant' else message['role'] -%}
    {#- Detect continuation: suppress duplicate <|turn>model when previous non-tool message was also assistant -#}
    {%- set prev_nt = namespace(role=None, found=false) -%}
    {%- if loop.index0 > 0 -%}
        {%- for j in range(loop.index0 - 1, -1, -1) -%}
            {%- if not prev_nt.found -%}
                {%- if loop_messages[j]['role'] != 'tool' -%}
                    {%- set prev_nt.role = loop_messages[j]['role'] -%}
                    {%- set prev_nt.found = true -%}
                {%- endif -%}
            {%- endif -%}
        {%- endfor -%}
    {%- endif -%}
    {%- set continue_same_model_turn = (role == 'model' and prev_nt.role == 'assistant') -%}
    {%- if not continue_same_model_turn -%}
        {{- '<|turn>' + role + '\n' }}
    {%- endif -%}
    {#- Render reasoning/reasoning_content as thinking channel -#}
    {%- set thinking_text = message.get('reasoning') or message.get('reasoning_content') -%}
    {%- if thinking_text and loop.index0 > ns_turn.last_user_idx and message.get('tool_calls') -%}
        {{- '<|channel>thought\n' + thinking_text + '\n<channel|>' -}}
    {%- endif -%}
            {%- if message['tool_calls'] -%}
                {%- for tool_call in message['tool_calls'] -%}
                    {%- set function = tool_call['function'] -%}
                    {{- '<|tool_call>call:' + function['name'] + '{' -}}
                    {%- if function['arguments'] is mapping -%}
                        {%- set ns_args = namespace(found_first=false) -%}
                        {%- for key, value in function['arguments'] | dictsort -%}
                            {%- if ns_args.found_first %},{% endif -%}
                            {%- set ns_args.found_first = true -%}
                            {{- key -}}:{{- format_argument(value, escape_keys=False) -}}
                        {%- endfor -%}
                    {%- elif function['arguments'] is string -%}
                        {{- function['arguments'] -}}
                    {%- endif -%}
                    {{- '}<tool_call|>' -}}
                {%- endfor -%}
                {%- set ns.prev_message_type = 'tool_call' -%}
            {%- endif -%}
            {%- set ns_tr_out = namespace(flag=false) -%}
            {%- if message.get('tool_responses') -%}
                {#- Legacy: tool_responses embedded on the assistant message (Google/Gemma native) -#}
                {%- for tool_response in message['tool_responses'] -%}
                    {{- format_tool_response_block(tool_response['name'] | default('unknown'), tool_response['response']) -}}
                    {%- set ns_tr_out.flag = true -%}
                    {%- set ns.prev_message_type = 'tool_response' -%}
                {%- endfor -%}
            {%- elif message.get('tool_calls') -%}
                {#- OpenAI Chat Completions: forward-scan consecutive role:tool messages -#}
                {%- set ns_tool_scan = namespace(stopped=false) -%}
                {%- for k in range(loop.index0 + 1, loop_messages | length) -%}
                    {%- if ns_tool_scan.stopped -%}
                    {%- elif loop_messages[k]['role'] != 'tool' -%}
                        {%- set ns_tool_scan.stopped = true -%}
                    {%- else -%}
                        {%- set follow = loop_messages[k] -%}
                        {#- Resolve tool_call_id to function name -#}
                        {%- set ns_tname = namespace(name=follow.get('name') | default('unknown')) -%}
                        {%- for tc in message['tool_calls'] -%}
                            {%- if tc.get('id') == follow.get('tool_call_id') -%}
                                {%- set ns_tname.name = tc['function']['name'] -%}
                            {%- endif -%}
                        {%- endfor -%}
                        {#- Handle content as string or content-parts array -#}
                        {%- set tool_body = follow.get('content') -%}
                        {%- if tool_body is string -%}
                            {{- format_tool_response_block(ns_tname.name, tool_body) -}}
                        {%- elif tool_body is sequence and tool_body is not string -%}
                            {%- set ns_txt = namespace(s='') -%}
                            {%- for part in tool_body -%}
                                {%- if part.get('type') == 'text' -%}
                                    {%- set ns_txt.s = ns_txt.s + (part.get('text') | default('')) -%}
                                {%- endif -%}
                            {%- endfor -%}
                            {{- format_tool_response_block(ns_tname.name, ns_txt.s) -}}
                        {%- else -%}
                            {{- format_tool_response_block(ns_tname.name, tool_body) -}}
                        {%- endif -%}
                        {%- set ns_tr_out.flag = true -%}
                        {%- set ns.prev_message_type = 'tool_response' -%}
                    {%- endif -%}
                {%- endfor -%}
            {%- endif -%}
            {%- set captured_content -%}
            {%- if message['content'] is string -%}
                {%- if role == 'model' -%}
                    {{- strip_thinking(message['content']) -}}
                {%- else -%}
                    {{- message['content'] | trim -}}
                {%- endif -%}
            {%- elif message['content'] is sequence -%}
                {%- for item in message['content'] -%}
                    {%- if item['type'] == 'text' -%}
                        {%- if role == 'model' -%}
                            {{- strip_thinking(item['text']) -}}
                        {%- else -%}
                            {{- item['text'] | trim -}}
                        {%- endif -%}
                    {%- elif item['type'] == 'image' -%}
                        {{- '<|image|>' -}}
                        {%- set ns.prev_message_type = 'image' -%}
                    {%- elif item['type'] == 'audio' -%}
                        {{- '<|audio|>' -}}
                        {%- set ns.prev_message_type = 'audio' -%}
                    {%- elif item['type'] == 'video' -%}
                        {{- '<|video|>' -}}
                        {%- set ns.prev_message_type = 'video' -%}
                    {%- endif -%}
                {%- endfor -%}
            {%- endif -%}
            {%- endset -%}
            {{- captured_content -}}
            {%- set has_content = captured_content | trim | length > 0 -%}
        {%- if ns.prev_message_type == 'tool_call' and not ns_tr_out.flag -%}
            {{- '<|tool_response>' -}}
        {%- elif not (ns_tr_out.flag and not has_content) -%}
            {{- '<turn|>\n' -}}
        {%- endif -%}
    {%- endif -%}
{%- endfor -%}
{%- if add_generation_prompt -%}
    {%- if ns.prev_message_type != 'tool_response' and ns.prev_message_type != 'tool_call' -%}
        {{- '<|turn>model\n' -}}
        {%- if not enable_thinking | default(false) -%}
            {{- '<|channel>thought\n<channel|>' -}}
        {%- endif -%}
    {%- endif -%}
{%- endif -%}"""
    def __init__(self, enable_thinking: bool = True, **kwargs):
        self.enable_thinking = enable_thinking
        super().__init__(**kwargs)
    def __call__(self, **kwargs):
        self.extra_template_arguments["enable_thinking"] = self.enable_thinking #type: ignore
        self.extra_template_arguments["bos_token"] = self.GEMMA4_BOS_TOKEN #type: ignore
        self.extra_template_arguments["eos_token"] = self.GEMMA4_EOS_TOKEN #type: ignore
        # Stop tokens patch
        kwargs['stop'] = ["<turn|>", "<|turn>", "<eos>", "<|im_end|>"]
        llama = kwargs['llama']
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        return super().__call__(**kwargs)
class FaraChatHandler(Llava15ChatHandler):
    CHAT_FORMAT = r"""{% set image_count = namespace(value=0) %}{% set video_count = namespace(value=0) %}{% for message in messages %}{% if loop.first and message['role'] != 'system' %}<|im_start|>system
You are a helpful assistant.<|im_end|>
{% endif %}<|im_start|>{{ message['role'] }}
{% if message['content'] is string %}{{ message['content'] }}<|im_end|>
{% else %}{% for content in message['content'] %}{% if content['type'] == 'image' or 'image' in content or 'image_url' in content %}{% set image_count.value = image_count.value + 1 %}{% if add_vision_id %}Picture {{ image_count.value }}: {% endif %}<|vision_start|><|image_pad|><|vision_end|>{% elif content['type'] == 'video' or 'video' in content %}{% set video_count.value = video_count.value + 1 %}{% if add_vision_id %}Video {{ video_count.value }}: {% endif %}<|vision_start|><|video_pad|><|video_end|>{% elif 'text' in content %}{{ content['text'] }}{% endif %}{% endfor %}<|im_end|>
{% endif %}{% endfor %}{% if add_generation_prompt %}<|im_start|>assistant
{% endif %}"""
    def __init__(self, add_vision_id: bool = True, **kwargs):
        self.add_vision_id = add_vision_id
        super().__init__(**kwargs)
    def __call__(self, **kwargs):
        self.extra_template_arguments["add_vision_id"] = self.add_vision_id #type: ignore
        llama = kwargs['llama']
        llama.reset()
        llama._ctx.memory_clear(True)
        llama.n_tokens = 0
        if hasattr(llama, 'input_ids'):
            llama.input_ids.fill(0)
        if hasattr(self, '_last_image_embed'):
            self._last_image_embed = None
            self._last_image_hash = None
        return super().__call__(**kwargs)
