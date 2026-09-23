import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderContext } from '../.test-dist/context.js';

test('resolves tools and prompt from current Pi transcript system message', () => {
  const tool = { name: 'ctx_execute', description: 'Execute sandbox code', parameters: { type: 'object', properties: { code: { type: 'string' } } } };
  const messages = [
    { role: 'system', content: 'Use available tools.', toolsAdded: [tool], timestamp: Date.now() },
    { role: 'user', content: [{ type: 'text', text: 'Run the tool.' }], timestamp: Date.now() },
  ];
  const result = resolveProviderContext(messages);
  assert.equal(result.systemPrompt, 'Use available tools.');
  assert.deepEqual(result.tools, [tool]);
});
