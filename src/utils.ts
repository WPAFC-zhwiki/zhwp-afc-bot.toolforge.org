/* eslint-disable es-x/no-nullish-coalescing-operators */
import express = require( 'express' );
import expressPackageJson = require( 'express/package.json' );
import util = require( 'util' );
import winston = require( 'winston' );

export function voidFunction() {
	// ignore
}

// eslint-disable-next-line max-len
function renderDefaultPage( code: number, req: express.Request, res: express.Response, args: Record<string, string> = {} ) {
	const pathname = new URL( req.originalUrl, 'https://zhwp-afc-bot.toolforge.org/' ).pathname;
	res.render( 'status/' + String( code ), {
		expressVersion: expressPackageJson.version,
		method: req.method.toUpperCase(),
		pathname,
		...args
	} );
}

export function rewriteUrl( newPrefix: string ) {
	return function ( req: express.Request, res: express.Response ) {
		movedPermanently( newPrefix + req.url, req, res );
	};
}

export function movedPermanently( location: string, req: express.Request, res: express.Response ) {
	res.status( 301 );
	res.set( 'Location', encodeURI( location ) );
	renderDefaultPage( 301, req, res, {
		location
	} );
	res.end();
}

export function badRequest( req: express.Request, res: express.Response ) {
	res.status( 400 );
	renderDefaultPage( 400, req, res );
	res.end();
}

export function forbidden( req: express.Request, res: express.Response ) {
	res.status( 403 );
	renderDefaultPage( 403, req, res );
	res.end();
}

export function notFound( req: express.Request, res: express.Response ) {
	res.status( 404 );
	renderDefaultPage( 404, req, res );
	res.end();
}

export function methodNoAllow( req: express.Request, res: express.Response ) {
	res.status( 405 );
	renderDefaultPage( 405, req, res );
	res.end();
}

export function internalServerError( req: express.Request, res: express.Response ) {
	res.status( 500 );
	renderDefaultPage( 500, req, res );
	res.end();
}

export interface SendFileOptions {
	root?: string;
	maxAge?: number;
}

export function sendFile( fileName: string, options: SendFileOptions = {} ) {
	options.maxAge = options.maxAge ?? 86400;
	return async function ( _req: express.Request, res: express.Response ) {
		winston.debug( util.format( 'Send file %s (options: %o)......', fileName, options ) );
		res.status( 200 );
		await new Promise<void>( function ( resolve, reject ) {
			res.sendFile( fileName, options, function ( error ) {
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
				if ( error ) {
					reject( error );
				}
				resolve();
			} );
		} );
		res.end();
	};
}

export interface SubRoute {
	init?(): Promise<void> | void;
	onRequest( req: express.Request, res: express.Response ): Promise<void> | void;
}
