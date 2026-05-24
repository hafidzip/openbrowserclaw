
export class MessageParser {
    static process(text: string): string {
        let processed = text;
        const { text: textWithoutComments, placeholders: commentPlaceholders } =
            this.protectHtmlComments(processed);
        processed = textWithoutComments;
        const { text: textWithoutComponents, placeholders: componentPlaceholders } =
            this.protectCustomComponents(processed);
        processed = textWithoutComponents;
        const { text: textWithoutTables, placeholders: tablePlaceholders } =
            this.protectMdxTables(processed);
        processed = textWithoutTables;
        const { protectedText, placeholders: codePlaceholders } =
            this.protectCodeBlocks(processed);
        processed = protectedText;
        processed = processed.replace(/<([a-zA-Z0-9]*)$/, '&lt;$1');
        processed = this.processThinkTags(processed);
        processed = this.escapeStrayAngleBrackets(processed);
        processed = this.autoCloseHtmlTags(processed);
        processed = this.escapeStrayBraces(processed);
        processed = this.restorePlaceholders(processed, codePlaceholders, '__CODE_BLOCK_');
        processed = this.restorePlaceholders(processed, tablePlaceholders, '__MDX_TABLE_');
        processed = this.restorePlaceholders(processed, componentPlaceholders, '__COMPONENT_');
        processed = this.restorePlaceholders(processed, commentPlaceholders, '__HTML_COMMENT_');
        processed = this.escapeThinkComponentBraces(processed);
        return processed;
    }
    static aggressiveEscape(text: string): string {
        let processed = text;
        const { protectedText: withCode, placeholders: codePlaceholders } =
            this.protectCodeBlocks(processed);
        const { text: withTables, placeholders: tablePlaceholders } =
            this.protectMdxTables(withCode);
        processed = withTables;
        processed = processed
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\{/g, '&#123;')
            .replace(/\}/g, '&#125;');
        processed = this.restorePlaceholders(processed, tablePlaceholders, '__MDX_TABLE_');
        processed = this.restorePlaceholders(processed, codePlaceholders, '__CODE_BLOCK_');
        processed = this.escapeThinkComponentBraces(processed);
        return processed;
    }
    private static protectHtmlComments(text: string): { text: string; placeholders: string[] } {
        const placeholders: string[] = [];
        const protectedText = text.replace(/<!--[\s\S]*?-->/g, (match) => {
            placeholders.push(match);
            return `__HTML_COMMENT_${placeholders.length - 1}__`;
        });
        return { text: protectedText, placeholders };
    }
    private static protectCustomComponents(text: string): { text: string; placeholders: string[] } {
        const placeholders: string[] = [];
        const result: string[] = [];
        let i = 0;
        const len = text.length;
        while (i < len) {
            const openMatch = /^<([A-Z][a-zA-Z0-9]*)(\s[\s\S]*?)?>/
                .exec(text.slice(i));
            if (!openMatch) {
                const nextOpen = text.indexOf('<', i + 1);
                if (nextOpen === -1) {
                    result.push(text.slice(i));
                    break;
                }
                result.push(text.slice(i, nextOpen));
                i = nextOpen;
                continue;
            }
            if (text[i] !== '<') {
                result.push(text[i]);
                i++;
                continue;
            }
            const tagName = openMatch[1];
            const fullOpenTag = openMatch[0];
            if (fullOpenTag.endsWith('/>') || /\/>$/.test(fullOpenTag)) {
                placeholders.push(fullOpenTag);
                result.push(`__COMPONENT_${placeholders.length - 1}__`);
                i += fullOpenTag.length;
                continue;
            }
            let depth = 1;
            let j = i + fullOpenTag.length;
            const scanRe = new RegExp(
                `<${tagName}(\\s[\\s\\S]*?)?>|<\\/${tagName}>`,
                'g'
            );
            scanRe.lastIndex = j;
            let found = false;
            let scanMatch: RegExpExecArray | null;
            while ((scanMatch = scanRe.exec(text)) !== null) {
                if (scanMatch[0].startsWith('</')) {
                    depth--;
                    if (depth === 0) {
                        const end = scanMatch.index + scanMatch[0].length;
                        const fullComponent = text.slice(i, end);
                        placeholders.push(fullComponent);
                        result.push(`__COMPONENT_${placeholders.length - 1}__`);
                        i = end;
                        found = true;
                        break;
                    }
                } else {
                    depth++;
                }
            }
            if (!found) {
                result.push(text[i]);
                i++;
            }
        }
        return { text: result.join(''), placeholders };
    }
    private static protectMdxTables(text: string): { text: string; placeholders: string[] } {
        const placeholders: string[] = [];
        const tableRegex = /((^|\n)\|[^\n]*\|[^\n]*)+/g;
        const protectedText = text.replace(tableRegex, (match) => {
            placeholders.push(match);
            return `__MDX_TABLE_${placeholders.length - 1}__`;
        });
        return { text: protectedText, placeholders };
    }
    private static protectCodeBlocks(text: string): { protectedText: string; placeholders: string[] } {
        const placeholders: string[] = [];
        let protectedText = text.replace(
            /(^|\n)(`{3,})([\s\S]*?)\n\2(\n|$)/g,
            (match, pre, _fence, _body, post) => {
                placeholders.push(match.slice(pre.length, match.length - post.length));
                return `${pre}__CODE_BLOCK_${placeholders.length - 1}__${post}`;
            }
        );
        protectedText = protectedText.replace(
            /(`+)([^`\n]+)\1/g,
            (match) => {
                placeholders.push(match);
                return `__CODE_BLOCK_${placeholders.length - 1}__`;
            }
        );
        return { protectedText, placeholders };
    }
    private static restorePlaceholders(text: string, placeholders: string[], prefix: string): string {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`${escaped}(\\d+)__`, 'g');
        return text.replace(regex, (_match, index) => placeholders[parseInt(index, 10)] ?? _match);
    }
    private static processThinkTags(text: string): string {
        const result: string[] = [];
        let lastIndex = 0;
        const stack: { index: number; tag: string }[] = [];
        const tagRegex = /<think(\s+[^>]*?)?>|<\/think>/gi;
        let match: RegExpExecArray | null;
        while ((match = tagRegex.exec(text)) !== null) {
            const fullTag = match[0];
            const isClosing = fullTag.toLowerCase().startsWith('</');
            if (!isClosing) {
                stack.push({ index: match.index, tag: fullTag });
            } else if (stack.length > 0) {
                const start = stack.pop()!;
                if (stack.length === 0) {
                    result.push(text.substring(lastIndex, start.index));
                    const content = text.substring(start.index + start.tag.length, match.index);
                    const attr = start.tag.match(/<think(\s+[^>]*?)?>/i)?.[1] ?? '';
                    result.push(`<Think${attr}>\n${this.escapeForThink(content)}\n</Think>`);
                    lastIndex = match.index + fullTag.length;
                }
            }
        }
        if (stack.length > 0) {
            const start = stack[0];
            result.push(text.substring(lastIndex, start.index));
            const content = text.substring(start.index + start.tag.length);
            const attr = start.tag.match(/<think(\s+[^>]*?)?>/i)?.[1] ?? '';
            result.push(`<Think${attr}>\n${this.escapeForThink(content)}\n</Think>`);
        } else {
            result.push(text.substring(lastIndex));
        }
        return result.join('');
    }
    private static escapeForThink(content: string): string {
        return content
            // 1. Base XML/HTML Characters (Must escape '&' first)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')

            // 2. JSX/MDX Expressions
            .replace(/\{/g, '&#123;')
            .replace(/\}/g, '&#125;')

            // 3. Markdown & Code Protections
            .replace(/`/g, '&#96;')   // Prevents unclosed inline code/code blocks from consuming text
            .replace(/\$/g, '&#36;')  // Prevents math (KaTeX/MathJax) plugins or template literal crashes
            .replace(/\\/g, '&#92;')  // Prevents backslashes from inadvertently escaping the next character
            .replace(/\[/g, '&#91;')  // Prevents accidental link/reference rendering 
            .replace(/\]/g, '&#93;')  // (Strict MDX parsers can crash on unresolvable reference links)

            // 4. (Optional) Prevent runaway emphasis rendering
            .replace(/\*/g, '&#42;')
            .replace(/_/g, '&#95;');
    }
    private static escapeThinkComponentBraces(text: string): string {
        return text.replace(
            /<Think(\s[^>]*)?>([\s\S]*?)<\/Think>/g,
            (_match, attrs = '', content) => {
                const escaped = content
                    // 1. Base XML/HTML Characters (Must escape '&' first)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;')

                    // 2. JSX/MDX Expressions
                    .replace(/\{/g, '&#123;')
                    .replace(/\}/g, '&#125;')

                    // 3. Markdown & Code Protections
                    .replace(/`/g, '&#96;')   // Prevents unclosed inline code/code blocks from consuming text
                    .replace(/\$/g, '&#36;')  // Prevents math (KaTeX/MathJax) plugins or template literal crashes
                    .replace(/\\/g, '&#92;')  // Prevents backslashes from inadvertently escaping the next character
                    .replace(/\[/g, '&#91;')  // Prevents accidental link/reference rendering 
                    .replace(/\]/g, '&#93;')  // (Strict MDX parsers can crash on unresolvable reference links)

                    // 4. (Optional) Prevent runaway emphasis rendering
                    .replace(/\*/g, '&#42;')
                    .replace(/_/g, '&#95;');
                return `<Think${attrs}>${escaped}</Think>`;
            }
        );
    }
    private static escapeStrayAngleBrackets(text: string): string {
        let result = text.replace(/<(?=[\s0-9!@#$%^&*()_+=|\\{}[\]:;,.?~`])/g, '&lt;');
        result = result.replace(/(?<=[\s0-9!@#$%^&*()_+=|\\{}[\]:;,.?~`])>/g, '&gt;');
        result = result.replace(/(?<=[a-zA-Z0-9])>(?=[a-zA-Z0-9])/g, '&gt;');
        return result;
    }
    private static escapeStrayBraces(text: string): string {
        const placeholders: string[] = [];
        let protected_ = text.replace(/=(\{(?:[^{}]|\{[^{}]*\})*\})/g, (match) => {
            placeholders.push(match);
            return `__BRACE_${placeholders.length - 1}__`;
        });
        protected_ = protected_
            .replace(/\{/g, '&#123;')
            .replace(/\}/g, '&#125;');
        const escaped = new RegExp('__BRACE_(\\d+)__', 'g');
        return protected_.replace(escaped, (_m, i) => placeholders[parseInt(i, 10)]);
    }
    private static autoCloseHtmlTags(text: string): string {
        const stack: string[] = [];
        const tagRegex = /<(\/?[a-zA-Z0-9]+)(\s+[^>]*?)?(\/?)>/g;
        const voidElements = new Set([
            'br', 'hr', 'img', 'input', 'link', 'meta',
            'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr',
        ]);
        const protectedTags = new Set([
            'Think', 'ThinkProvider', 'ToolCall',
        ]);
        let match: RegExpExecArray | null;
        while ((match = tagRegex.exec(text)) !== null) {
            const tagName = match[1];
            const isSelfClosing = match[3] === '/';
            const isClosing = tagName.startsWith('/');
            const name = isClosing ? tagName.substring(1) : tagName;
            const nameLower = name.toLowerCase();
            if (protectedTags.has(name) || voidElements.has(nameLower) || isSelfClosing) {
                continue;
            }
            if (isClosing) {
                if (stack.length > 0 && stack[stack.length - 1] === nameLower) {
                    stack.pop();
                }
            } else {
                stack.push(nameLower);
            }
        }
        let result = text;
        while (stack.length > 0) {
            result += `</${stack.pop()}>`;
        }
        return result;
    }
}