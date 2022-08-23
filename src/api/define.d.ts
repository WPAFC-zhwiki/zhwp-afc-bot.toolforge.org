declare module '@app/api/*' {
	import express = require( 'express' );

	export function init(): Promise<void> | void;
	export function onRequest( req: express.Request, res: express.Response ): Promise<void> | void;
}
