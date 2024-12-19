declare module '@app/api/*' {
	import express from 'express';

	export function init(): Promise<void> | void;
	export function onRequest( request: express.Request, response: express.Response ): Promise<void> | void;
}
