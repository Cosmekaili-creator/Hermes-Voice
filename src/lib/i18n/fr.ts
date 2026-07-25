import type { Messages } from './types';

export const fr = {
	'meta.title': 'Hermes Voice',
	'meta.language': 'Langue',

	'status.idle': 'Appuyez pour parler',
	'status.listening': 'Écoute… appuyez à nouveau quand vous avez fini',
	'status.thinking': 'Un instant…',
	'status.hermesWorking': 'Hermes travaille…',
	'status.hermesStill': 'Toujours en cours…',
	'status.hermesAlmost': 'Presque terminé…',
	'status.speaking': 'Hermes parle…',
	'status.connecting': 'Connexion…',
	'status.cancelArm': 'Appuyez encore pour annuler',
	'status.cancelled': 'Annulé',

	'button.pressToTalk': 'Appuyez pour parler',
	'button.finishSpeaking': 'Terminer',
	'button.stopHermes': 'Arrêter Hermes',
	'button.hermesThinking': 'Hermes réfléchit',
	'button.cancel': 'Annuler',
	'button.cancelArm': 'Appuyez encore pour annuler',
	'button.connecting': 'Connexion…',
	'button.reconnect': 'Reconnecter',

	'error.micDenied': 'Micro refusé — autorisez l’accès dans le navigateur, puis réessayez',
	'error.couldNotStart': 'Impossible de démarrer la voix',
	'error.sessionUnauthorized': 'Session non autorisée',
	'error.sessionUnavailable': 'Session indisponible',
	'error.sessionRequestFailed': 'Échec de la demande de session',
	'error.sessionConnectTimeout': 'Délai de connexion dépassé',
	'error.websocketError': 'Erreur WebSocket',
	'error.websocketClosed': 'WebSocket fermé',
	'error.websocketFailed': 'Échec WebSocket',
	'error.connectionLost': 'Connexion perdue — appuyez pour reconnecter',
	'error.noReply': 'Pas de réponse — réessayez',
	'error.couldNotContinue': 'Impossible de continuer après Hermes',
	'error.hermesTimeout': 'Hermes a pris trop de temps — réessayez',
	'error.voiceToolError': 'Erreur de l’outil vocal',
	'error.voiceError': 'Erreur vocale',
	'error.couldNotSendAudio': 'Impossible d’envoyer l’audio',
	'error.realtimeSessionError': 'Erreur de session temps réel',

	'gate.accessRestricted': 'Accès restreint'
} satisfies Messages;
