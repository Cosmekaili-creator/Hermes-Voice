import { describe, expect, it } from 'vitest';
import { approvalSummary, isAffirmative, looksLikeSideEffect, needsApproval } from './approvals';

describe('looksLikeSideEffect', () => {
	it('flags imperative side-effect briefs', () => {
		for (const brief of [
			'Send an email to Marc asking to move the call to Thursday.',
			'Find the Baan Thai restaurant and book a table for two at 8pm.',
			'Look up the concert date, then add it to my calendar.',
			'Please delete the draft called Q3 notes.',
			'Reply to Anna saying yes.',
			'Could you send Marc an email about Thursday?',
			'I need you to email the landlord about the heating.',
			'Let Marc know I will be late.',
			'Tell Marc via Slack that the deploy is done.',
			'Wire 500 euros to Anna.',
			'Ping the team channel.',
			'Turn off the lights in the living room.',
			'Unlock the front door.',
			'Mark all emails as read.',
			'Grant Bob access to the shared drive.',
			'Merge the open PR.',
			'Write to the landlord about the leak.',
			'Remind Marc about the invoice.',
			'Envoie un email à Marc pour décaler la réunion.',
			'Réserve une table pour deux ce soir.',
			'Reserva una mesa para dos esta noche.',
			'Envía un correo a Ana.',
			'Please, send the invoice to accounting.',
			'Kindly forward the contract to Bob.',
			'Hermes should send the report tonight.',
			'Follow up with Marc about the quote.',
			'Sign the contract in DocuSign.',
			'Confirm the booking for Friday.',
			'Give Bob edit access to the doc.',
			'Disable two-factor on the test account.',
			'Mets à jour le document partagé.',
			'Envoyez la facture au client.',
			'Manda un correo a Pedro.'
		]) {
			expect(looksLikeSideEffect(brief), brief).toBe(true);
		}
	});

	it('does not flag read-only lookups that merely mention those words', () => {
		for (const brief of [
			'What did Marc send me yesterday?',
			'Summarize my unread email.',
			'What is the weather in Lyon this weekend?',
			'Which meetings were cancelled this week?',
			'Open the event page and read me the lineup.',
			'Find the opening hours of the museum.',
			'Quel temps fera-t-il demain à Lyon ?',
			'¿Qué tiempo hará mañana en Madrid?',
			'Tell me a joke about cats.',
			'Let me think about it.',
			'Remind me what we discussed yesterday.',
			'Mark my words, it will rain.',
			'Add up these numbers: 4, 8 and 15.',
			'Order of operations in maths?',
			'Share price of Apple today.',
			'Text summary of the article, please.'
		]) {
			expect(looksLikeSideEffect(brief), brief).toBe(false);
		}
	});
});

describe('needsApproval', () => {
	it('honours the model flag, the backstop, and the user toggle', () => {
		expect(needsApproval('Summarize my unread email.', true, true)).toBe(true);
		expect(needsApproval('Send Marc a note.', false, true)).toBe(true);
		expect(needsApproval('Send Marc a note.', true, false)).toBe(false);
		expect(needsApproval('Summarize my unread email.', false, true)).toBe(false);
	});
});

describe('approvalSummary', () => {
	it('prefers the model summary, else the first sentence, capped', () => {
		expect(approvalSummary('Send it. Then more.', 'Email Marc')).toBe('Email Marc');
		expect(approvalSummary('Send it. Then more.')).toBe('Send it.');
		expect(approvalSummary('x'.repeat(300)).length).toBeLessThanOrEqual(140);
	});
});

describe('isAffirmative', () => {
	it('accepts clear yeses in en/fr/es and rejects anything with a negation', () => {
		for (const yes of ['Yes, send it', 'ok go ahead', 'Oui, vas-y', 'Sí, adelante', 'Sure.']) {
			expect(isAffirmative(yes), yes).toBe(true);
		}
		for (const no of [
			'No',
			'wait, no',
			"don't",
			'yes — no wait',
			'what time is it?',
			'Non',
			'Espera',
			''
		]) {
			expect(isAffirmative(no), no).toBe(false);
		}
	});
});
