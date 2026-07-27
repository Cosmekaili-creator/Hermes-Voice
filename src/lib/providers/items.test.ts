import { describe, expect, it } from 'vitest';
import { userTextItem } from './items';

describe('userTextItem', () => {
	it('builds the exact conversation.item.create item shape', () => {
		expect(userTextItem('hello there')).toEqual({
			type: 'message',
			role: 'user',
			content: [{ type: 'input_text', text: 'hello there' }]
		});
	});
});
