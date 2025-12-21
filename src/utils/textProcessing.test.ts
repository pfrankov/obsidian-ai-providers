import { preprocessContent, splitContent } from './textProcessing';

describe('textProcessing', () => {
    describe('preprocessContent', () => {
        it('should remove frontmatter', () => {
            const content = `---
title: Test
---
This is content`;
            const result = preprocessContent(content);
            expect(result).toBe('This is content');
        });

        it('should remove code blocks', () => {
            const content = `Some text
\`\`\`javascript
console.log('test');
\`\`\`
More text`;
            const result = preprocessContent(content);
            expect(result).toBe('Some text\n\nMore text');
        });

        it('should handle empty content', () => {
            const result = preprocessContent('');
            expect(result).toBe('');
        });

        it('should remove trailing spaces and newlines', () => {
            const content = `Some text with trailing spaces   
And trailing newlines


`;
            const result = preprocessContent(content);
            expect(result).toBe(
                'Some text with trailing spaces\nAnd trailing newlines'
            );
        });

        it('should handle mixed trailing whitespace', () => {
            const content = `Line with spaces   
Line with tabs\t\t
Mixed whitespace \t 

Final line`;
            const result = preprocessContent(content);
            expect(result).toBe(
                'Line with spaces\nLine with tabs\nMixed whitespace\n\nFinal line'
            );
        });
    });

    describe('splitContent', () => {
        it('should return single chunk for short content', () => {
            const content = 'Short content';
            const result = splitContent(content);
            expect(result).toEqual(['Short content']);
        });

        it('should split long content into chunks', () => {
            const longContent = 'a'.repeat(2000);
            const result = splitContent(longContent);
            expect(result.length).toBeGreaterThan(1);
            result.forEach(chunk => {
                expect(chunk.length).toBeLessThanOrEqual(1000);
            });
        });

        it('should handle empty content', () => {
            const result = splitContent('');
            expect(result).toEqual(['']);
        });

        it('should remove trailing spaces and newlines from chunks', () => {
            const content = `First chunk with trailing spaces   

Second chunk with trailing newlines


`;
            const result = splitContent(content);
            result.forEach(chunk => {
                expect(chunk).not.toMatch(/\s+$/);
            });
        });

        it('should keep headers with their following content', () => {
            const content = `## System Prompt for ChatGPT:

**Objective:** To act as a helpful, informative, and harmless AI assistant while prioritizing user privacy and data security.

**Guidelines:**

1. **Privacy First:** Never store or use any personal information from user interactions for any purpose other than completing the immediate task requested. Treat all user data as confidential.

2. **Anonymity:** Avoid identifying individuals in your responses, even indirectly. Do not reference specific locations, real names, or identifiable details unless explicitly permitted by the user.

3. **Transparency:** Clearly state when you are accessing or using information from external sources. Cite your sources whenever possible.

4. **No Personal Opinions or Beliefs:** Present information objectively and avoid expressing personal opinions, beliefs, or emotions.

5. **Harmlessness:** Refuse to engage in conversations that promote violence, hate speech, discrimination, or illegal activities.

6. **Fact-Checking:** Strive to provide accurate information. If you are unsure about something, acknowledge the uncertainty and suggest further research.

7. **Helpfulness:** Be polite, helpful, and patient in your responses. Aim to understand user requests and provide clear, concise answers.

**Example Interaction:**

User: "Can you help me understand climate change?"`;

            const result = splitContent(content);

            // Header should NOT be alone in a chunk
            const headerOnlyChunk = result.find(
                chunk =>
                    chunk.includes('## System Prompt for ChatGPT:') &&
                    !chunk.includes('**Objective:**')
            );
            expect(headerOnlyChunk).toBeUndefined();

            // Header should be together with the objective
            const headerWithContentChunk = result.find(
                chunk =>
                    chunk.includes('## System Prompt for ChatGPT:') &&
                    chunk.includes('**Objective:**')
            );
            expect(headerWithContentChunk).toBeDefined();
        });

        it('should keep headers with lists together', () => {
            const content = `## Configuration Options

- Option 1: Description
- Option 2: Description
- Option 3: Description

## Installation Steps

1. First step
2. Second step
3. Third step`;

            const result = splitContent(content);

            // Configuration header should be with its list
            const configChunk = result.find(chunk =>
                chunk.includes('## Configuration Options')
            );
            expect(configChunk).toBeDefined();
            expect(configChunk).toContain('- Option 1');

            // Installation header should be with its list
            const installChunk = result.find(chunk =>
                chunk.includes('## Installation Steps')
            );
            expect(installChunk).toBeDefined();
            expect(installChunk).toContain('1. First step');
        });

        it('should handle edge case with multiple consecutive headers', () => {
            const content = `# Main Title

## Section 1

## Section 2

Some content for section 2.

## Section 3

More content here.`;

            const result = splitContent(content);

            // Check that headers don't remain empty
            result.forEach(chunk => {
                const lines = chunk.trim().split('\n');
                if (lines.length === 1 && /^#{1,6}\s+.+$/.test(lines[0])) {
                    // If chunk contains only a header, this is a problem
                    throw new Error(`Header-only chunk found: "${chunk}"`);
                }
            });

            // Section 2 should be with its content
            const section2Chunk = result.find(chunk =>
                chunk.includes('## Section 2')
            );
            expect(section2Chunk).toBeDefined();
            expect(section2Chunk).toContain('Some content for section 2');
        });

        it('splits oversized lines while preserving existing chunks', () => {
            const longLine = 'a'.repeat(1200);
            const content = `Intro line\n${longLine}`;

            const result = splitContent(content);

            expect(result[0]).toContain('Intro line');
            result.forEach(chunk => {
                expect(chunk.length).toBeLessThanOrEqual(1000);
            });
        });

        it('starts a new chunk when combined line length exceeds max', () => {
            const line = 'b'.repeat(600);
            const content = `${line}\n${line}`;

            const result = splitContent(content);

            expect(result.length).toBeGreaterThan(1);
            result.forEach(chunk => {
                expect(chunk.length).toBeLessThanOrEqual(1000);
            });
        });

        it('keeps pre-header text when splitting by headers', () => {
            const filler = 'a'.repeat(1100);
            const content = `Intro text before header
${filler}

# Header Title
Body text`;

            const result = splitContent(content);

            expect(
                result.some(chunk => chunk.includes('Intro text before header'))
            ).toBe(true);
        });

        it('starts a new list chunk when near size limit', () => {
            const longLine = 'x'.repeat(995);
            const content = `${longLine}\n- item`;

            const result = splitContent(content);

            expect(result.some(chunk => chunk.includes('- item'))).toBe(true);
            expect(
                result.some(
                    chunk =>
                        chunk.includes(longLine) && chunk.includes('- item')
                )
            ).toBe(true);
        });

        it('handles oversized list items at the start', () => {
            const longItem = `- ${'a'.repeat(1100)}`;
            const result = splitContent(longItem);

            expect(result.some(chunk => chunk.includes('-'))).toBe(true);
        });

        it('keeps lastNonListText when an empty line overflows chunk', () => {
            const longLine = 'b'.repeat(1000);
            const content = `${longLine}\n\nnext`;

            const result = splitContent(content);

            expect(result[0]).toContain(longLine);
            expect(result.some(chunk => chunk.includes('next'))).toBe(true);
        });

        it('uses non-empty line as lastNonListText when chunk overflows', () => {
            const longLine = 'c'.repeat(1000);
            const content = `${longLine}\nword`;

            const result = splitContent(content);

            expect(result[0]).toContain(longLine);
        });

        it('splits long lines on whitespace boundaries when possible', () => {
            const longLine = `${'a'.repeat(900)} ${'b'.repeat(200)}`;
            const result = splitContent(longLine);

            expect(result.length).toBeGreaterThan(1);
        });
    });
});
