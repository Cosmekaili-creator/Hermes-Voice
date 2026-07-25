import type { Messages } from './types';

export const es = {
	'meta.title': 'Hermes Voice',
	'meta.language': 'Idioma',
	'meta.talkMode': 'Modo de habla',

	'mode.ptt': 'Pulsar para hablar',
	'mode.handsfree': 'Manos libres',

	'status.idle': 'Pulsa para hablar',
	'status.idleHandsfree': 'Pulsa para escuchar',
	'status.listening': 'Escuchando… pulsa de nuevo al terminar',
	'status.listeningHandsfree': 'Escuchando… pulsa para parar',
	'status.thinking': 'Un momento…',
	'status.hermesWorking': 'Hermes está trabajando…',
	'status.hermesStill': 'Sigo en ello…',
	'status.hermesAlmost': 'Casi listo…',
	'status.speaking': 'Hermes hablando…',
	'status.connecting': 'Conectando…',
	'status.cancelArm': 'Pulsa de nuevo para cancelar',
	'status.cancelled': 'Cancelado',

	'button.pressToTalk': 'Pulsa para hablar',
	'button.armHandsfree': 'Pulsa para escuchar',
	'button.finishSpeaking': 'Terminar de hablar',
	'button.disarmHandsfree': 'Dejar de escuchar',
	'button.stopHermes': 'Detener a Hermes',
	'button.hermesThinking': 'Hermes está pensando',
	'button.cancel': 'Cancelar',
	'button.cancelArm': 'Pulsa de nuevo para cancelar',
	'button.connecting': 'Conectando…',
	'button.reconnect': 'Reconectar',

	'error.micDenied': 'Micrófono denegado — permite el acceso en el navegador e inténtalo de nuevo',
	'error.couldNotStart': 'No se pudo iniciar la voz',
	'error.sessionUnauthorized': 'Sesión no autorizada',
	'error.sessionUnavailable': 'Sesión no disponible',
	'error.sessionRequestFailed': 'Falló la solicitud de sesión',
	'error.sessionConnectTimeout': 'Tiempo de conexión agotado',
	'error.websocketError': 'Error de WebSocket',
	'error.websocketClosed': 'WebSocket cerrado',
	'error.websocketFailed': 'Falló el WebSocket',
	'error.connectionLost': 'Conexión perdida — pulsa para reconectar',
	'error.noReply': 'Sin respuesta — inténtalo de nuevo',
	'error.couldNotContinue': 'No se pudo continuar después de Hermes',
	'error.hermesTimeout': 'Hermes tardó demasiado — inténtalo de nuevo',
	'error.voiceToolError': 'Error de herramienta de voz',
	'error.voiceError': 'Error de voz',
	'error.couldNotSendAudio': 'No se pudo enviar el audio',
	'error.realtimeSessionError': 'Error de sesión en tiempo real',

	'gate.accessRestricted': 'Acceso restringido'
} satisfies Messages;
